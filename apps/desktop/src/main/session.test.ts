// @vitest-environment node
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspect } from "node:util";

import { configure, reset as resetLogging } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { NewSession } from "../shared/bridge";
import type { SecretStore } from "./host";
import { createSessionStore } from "./session";
import type { TokenCrypto } from "./session";

const DEVICE_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const USER_ID = "4c1b0a6e2f3d4e5f8a9b0c1d2e3f4a5b";

const newSession = NewSession.parse({
  serverUrl: "http://127.0.0.1:8096",
  serverId: "server-1",
  serverName: "Dev",
  serverVersion: "10.11.0",
  userId: USER_ID,
  userName: "harakiri",
  accessToken: "secret-token",
});

const expectedSession = {
  serverUrl: "http://127.0.0.1:8096/",
  serverId: "server-1",
  serverName: "Dev",
  serverVersion: "10.11.0",
  userId: USER_ID,
  userName: "harakiri",
  accessToken: "secret-token",
  deviceId: DEVICE_ID,
};

const prefixing: TokenCrypto = {
  encryptStringAsync: async (plain) => await Promise.resolve(Buffer.from(`enc:${plain}`, "utf-8")),
  decryptStringAsync: async (encrypted) =>
    await Promise.resolve({
      result: encrypted.toString("utf-8").replace(/^enc:/u, ""),
      shouldReEncrypt: false,
    }),
};

// What safeStorage does where no keyring opens, or where the keyring changed: it rejects.
const locked: TokenCrypto = {
  encryptStringAsync: async () => await Promise.reject(new Error("no keyring")),
  decryptStringAsync: async () => await Promise.reject(new Error("no keyring")),
};

const unavailable = locked;

/** A crypto whose decryption waits for `gate`, and asks for the token to be encrypted again. */
const gatedResealing = (gate: Promise<undefined>): TokenCrypto => ({
  ...prefixing,
  decryptStringAsync: async (encrypted) => {
    await gate;
    const { result } = await prefixing.decryptStringAsync(encrypted);

    return { result, shouldReEncrypt: true };
  },
});

/** Captures what `harakiri` logs while `run` runs. */
const recording = async (run: () => Promise<void>): Promise<LogRecord[]> => {
  const records: LogRecord[] = [];
  await configure({
    reset: true,
    sinks: {
      memory: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ["harakiri"], lowestLevel: "debug", sinks: ["memory"] },
      { category: ["logtape", "meta"], sinks: [] },
    ],
  });

  try {
    await run();
  } finally {
    await resetLogging();
  }

  return records;
};

describe("session store", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "harakiri-session-"));
    writeFileSync(path.join(dir, "device-id"), DEVICE_ID);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const store = (crypto: TokenCrypto, secretStore: SecretStore = "keyring") =>
    createSessionStore({ dir, crypto, secretStore });

  const readStored = () =>
    z.json().parse(JSON.parse(readFileSync(path.join(dir, "session.json"), "utf-8")));

  // The async calls cannot read what the sync call wrote; only `decryptLegacy` can.
  const legacyFile = () => {
    const { accessToken, ...rest } = newSession;
    writeFileSync(
      path.join(dir, "session.json"),
      JSON.stringify({
        ...rest,
        token: {
          kind: "encrypted",
          base64: Buffer.from(`legacy:${accessToken}`).toString("base64"),
        },
      })
    );
  };

  it("round-trips a session with the token encrypted on disk and main's device id", async () => {
    await store(prefixing).save(newSession);

    expect(readStored()).toStrictEqual({
      serverUrl: "http://127.0.0.1:8096/",
      serverId: "server-1",
      serverName: "Dev",
      serverVersion: "10.11.0",
      userId: USER_ID,
      userName: "harakiri",
      token: { kind: "encrypted", base64: Buffer.from("enc:secret-token").toString("base64") },
    });
    await expect(store(prefixing).load()).resolves.toStrictEqual(expectedSession);
  });

  it("a device id smuggled into the payload is replaced by main's", async () => {
    const smuggled = { ...newSession, deviceId: "renderer-made" };
    await store(prefixing).save(smuggled);

    await expect(store(prefixing).load()).resolves.toMatchObject({ deviceId: DEVICE_ID });
  });

  it("clear removes the stored session", async () => {
    const s = store(prefixing);
    await s.save(newSession);
    s.clear();

    await expect(s.load()).resolves.toBeNull();
    await expect(store(prefixing).load()).resolves.toBeNull();
  });

  it("a clear while a save is still encrypting wins: nothing is written", async () => {
    const gate = Promise.withResolvers<undefined>();

    const slow: TokenCrypto = {
      ...prefixing,
      encryptStringAsync: async (plain) => {
        await gate.promise;

        return await prefixing.encryptStringAsync(plain);
      },
    };

    const s = store(slow);
    const saving = s.save(newSession);
    s.clear();
    gate.resolve(undefined);
    await saving;

    expect(readdirSync(dir)).toStrictEqual(["device-id"]);
    await expect(s.load()).resolves.toBeNull();
  });

  it("a corrupt file loads as null", async () => {
    writeFileSync(path.join(dir, "session.json"), "{not json");

    await expect(store(prefixing).load()).resolves.toBeNull();
  });

  it("an undecryptable token loads as null", async () => {
    await store(prefixing).save(newSession);

    await expect(store(locked).load()).resolves.toBeNull();
  });

  it("without a keyring the session survives a restart through a 0600 obfuscated file", async () => {
    await store(unavailable, "file").save(newSession);

    expect(readStored()).toMatchObject({
      token: { kind: "obfuscated", base64: Buffer.from("secret-token").toString("base64") },
    });
    expect(statSync(path.join(dir, "session.json")).mode.toString(8).slice(-3)).toBe("600");
    await expect(store(unavailable, "file").load()).resolves.toStrictEqual(expectedSession);
  });

  it("a keyring session read where no keyring opens is null, and the next sign-in writes one both can read", async () => {
    await store(prefixing, "keyring").save(newSession);
    await expect(store(locked, "file").load()).resolves.toBeNull();
    await store(locked, "file").save(newSession);
    await expect(store(prefixing, "keyring").load()).resolves.toStrictEqual(expectedSession);
  });

  it("a token Electron asks to re-encrypt is written again", async () => {
    let encryptions = 0;

    // Each encryption uses a newer key; Electron asks for a token under the first one again.
    const rotating: TokenCrypto = {
      encryptStringAsync: async (plain) => {
        encryptions += 1;

        return await Promise.resolve(Buffer.from(`v${encryptions}:${plain}`, "utf-8"));
      },
      decryptStringAsync: async (encrypted) => {
        const groups = /^v(?<version>\d+):(?<token>.*)$/u.exec(encrypted.toString("utf-8"))?.groups;

        return await Promise.resolve({
          result: groups?.token ?? "",
          shouldReEncrypt: groups?.version === "1",
        });
      },
    };

    await store(rotating).save(newSession);
    await expect(store(rotating).load()).resolves.toStrictEqual(expectedSession);

    expect(encryptions).toBe(2);
    expect(readStored()).toMatchObject({
      token: { kind: "encrypted", base64: Buffer.from("v2:secret-token").toString("base64") },
    });
    await expect(store(rotating).load()).resolves.toStrictEqual(expectedSession);
    expect(encryptions).toBe(2);
  });

  it("a clear while a load is still decrypting wins: the load is null and writes nothing", async () => {
    await store(prefixing).save(newSession);
    const gate = Promise.withResolvers<undefined>();
    const s = store(gatedResealing(gate.promise), "keyring");
    const loading = s.load();
    s.clear();
    gate.resolve(undefined);

    await expect(loading).resolves.toBeNull();
    expect(readdirSync(dir)).toStrictEqual(["device-id"]);
  });

  it("a clear while a load is still decrypting leaves storage to what the host offers", async () => {
    await store(prefixing).save(newSession);
    const gate = Promise.withResolvers<undefined>();
    const s = store(gatedResealing(gate.promise), "file");
    const loading = s.load();
    s.clear();
    gate.resolve(undefined);

    await expect(loading).resolves.toBeNull();
    expect(s.storage()).toBe("file");
  });

  it("on a host without a keyring, a token Electron asks to re-encrypt is left as it is", async () => {
    await store(prefixing).save(newSession);
    const before = readFileSync(path.join(dir, "session.json"), "utf-8");
    let encryptions = 0;

    const resealing: TokenCrypto = {
      encryptStringAsync: async (plain) => {
        encryptions += 1;

        return await prefixing.encryptStringAsync(plain);
      },
      decryptStringAsync: async (encrypted) => ({
        ...(await prefixing.decryptStringAsync(encrypted)),
        shouldReEncrypt: true,
      }),
    };

    await expect(store(resealing, "file").load()).resolves.toStrictEqual(expectedSession);
    expect(encryptions).toBe(0);
    expect(readFileSync(path.join(dir, "session.json"), "utf-8")).toBe(before);
  });

  it("the log for an unreadable session file never quotes the file", async () => {
    const tokenLike = Buffer.from("secret-token-value").toString("base64");
    writeFileSync(path.join(dir, "session.json"), `${tokenLike}{"kind":"obfuscated"`);

    const records = await recording(async () => {
      await expect(store(prefixing).load()).resolves.toBeNull();
    });

    expect(records.map(({ level }) => level)).toStrictEqual(["error"]);
    expect(inspect(records, { depth: 10 })).not.toContain(tokenLike.slice(0, 8));
    expect(records[0]?.properties).toStrictEqual({
      file: path.join(dir, "session.json"),
      reason: "SyntaxError",
    });
  });

  it("the log for a session file of the wrong shape names only the fields", async () => {
    const tokenLike = Buffer.from("secret-token-value").toString("base64");
    writeFileSync(
      path.join(dir, "session.json"),
      JSON.stringify({ token: { kind: tokenLike, base64: tokenLike } })
    );

    const records = await recording(async () => {
      await expect(store(prefixing).load()).resolves.toBeNull();
    });

    expect(inspect(records, { depth: 10 })).not.toContain(tokenLike.slice(0, 8));
    expect(String(records[0]?.properties.reason)).toMatch(/^ZodError at .*token\.kind/u);
  });

  describe("a token encrypted by the synchronous safeStorage call of earlier builds", () => {
    const asyncOnly: TokenCrypto = {
      encryptStringAsync: async (plain) => await Promise.resolve(Buffer.from(`async:${plain}`)),
      decryptStringAsync: async (encrypted) => {
        const text = encrypted.toString("utf-8");

        if (!text.startsWith("async:")) {
          throw new Error("Error while decrypting the ciphertext");
        }

        return await Promise.resolve({ result: text.slice(6), shouldReEncrypt: false });
      },
    };

    let legacyCalls = 0;

    const withLegacy: TokenCrypto = {
      ...asyncOnly,
      decryptLegacy: (encrypted) => {
        legacyCalls += 1;
        const text = encrypted.toString("utf-8");

        if (!text.startsWith("legacy:")) {
          throw new Error("legacy decrypt failed");
        }

        return text.slice(7);
      },
    };

    beforeEach(() => {
      legacyCalls = 0;
      legacyFile();
    });

    it("is read once through the legacy call and written again with the async one", async () => {
      const records = await recording(async () => {
        await expect(store(withLegacy).load()).resolves.toStrictEqual(expectedSession);
      });

      expect(legacyCalls).toBe(1);
      expect(readStored()).toMatchObject({
        token: { kind: "encrypted", base64: Buffer.from("async:secret-token").toString("base64") },
      });
      expect(records.map(({ level, rawMessage }) => ({ level, rawMessage }))).toStrictEqual([
        { level: "info", rawMessage: "migrated the saved session to the async keyring format" },
      ]);

      await expect(store(withLegacy).load()).resolves.toStrictEqual(expectedSession);
      expect(legacyCalls).toBe(1);
    });

    it("loads as null when the legacy call cannot read it either", async () => {
      const { accessToken, ...rest } = newSession;
      writeFileSync(
        path.join(dir, "session.json"),
        JSON.stringify({
          ...rest,
          token: { kind: "encrypted", base64: Buffer.from(accessToken).toString("base64") },
        })
      );

      await expect(store(withLegacy).load()).resolves.toBeNull();
      expect(legacyCalls).toBe(1);
    });

    it("loads as null without a legacy call", async () => {
      await expect(store(asyncOnly).load()).resolves.toBeNull();
    });

    it("is not written again on a host without a keyring", async () => {
      const before = readFileSync(path.join(dir, "session.json"), "utf-8");

      await expect(store(withLegacy, "file").load()).resolves.toStrictEqual(expectedSession);
      expect(readFileSync(path.join(dir, "session.json"), "utf-8")).toBe(before);
    });
  });

  it("an old plain-text file reads as null", async () => {
    const { accessToken, ...rest } = newSession;
    writeFileSync(
      path.join(dir, "session.json"),
      JSON.stringify({ ...rest, token: { kind: "plain", value: accessToken } })
    );

    await expect(store(prefixing).load()).resolves.toBeNull();
    await expect(store(unavailable, "file").load()).resolves.toBeNull();
  });

  it("storage names where the store keeps the token", () => {
    expect(store(prefixing).storage()).toBe("keyring");
    expect(store(unavailable, "file").storage()).toBe("file");
  });

  it("a token saved without a keyring reads as kept in the file on a host that has one", async () => {
    await store(unavailable, "file").save(newSession);
    const s = store(prefixing, "keyring");

    await expect(s.load()).resolves.toStrictEqual(expectedSession);
    expect(s.storage()).toBe("file");
    expect(readStored()).toMatchObject({ token: { kind: "obfuscated" } });
  });

  it("storage follows the token saved last, and clear falls back to what the host offers", async () => {
    await store(unavailable, "file").save(newSession);
    const s = store(prefixing, "keyring");
    await s.load();
    expect(s.storage()).toBe("file");

    s.clear();
    expect(s.storage()).toBe("keyring");

    await s.save(newSession);
    expect(s.storage()).toBe("keyring");

    const fileStore = store(unavailable, "file");
    await expect(fileStore.load()).resolves.toBeNull();
    expect(fileStore.storage()).toBe("file");
  });

  it("without a keyring the store says where the session is kept, once", async () => {
    const records: LogRecord[] = [];
    await configure({
      reset: true,
      sinks: {
        memory: (record) => {
          records.push(record);
        },
      },
      loggers: [
        { category: ["harakiri"], lowestLevel: "debug", sinks: ["memory"] },
        { category: ["logtape", "meta"], sinks: [] },
      ],
    });

    try {
      const s = store(unavailable, "file");
      await s.save(newSession);
      await s.save(newSession);
      await store(prefixing).save(newSession);
    } finally {
      await resetLogging();
    }

    expect(
      records.map(({ level, rawMessage, properties }) => ({ level, rawMessage, properties }))
    ).toStrictEqual([
      {
        level: "info",
        rawMessage: "No keyring: the session is kept in {file}, readable only by this user",
        properties: { file: path.join(dir, "session.json") },
      },
    ]);
  });

  it("a save replaces an existing file atomically with mode 0600 and leaves no temp file", async () => {
    writeFileSync(path.join(dir, "session.json"), "{}");
    chmodSync(path.join(dir, "session.json"), 0o644);

    await store(prefixing).save(newSession);

    expect(readdirSync(dir).toSorted()).toStrictEqual(["device-id", "session.json"]);
    expect(statSync(path.join(dir, "session.json")).mode.toString(8).slice(-3)).toBe("600");
    await expect(store(prefixing).load()).resolves.toStrictEqual(expectedSession);
  });

  it("the device id is generated once, survives a restart and is written 0600", () => {
    rmSync(path.join(dir, "device-id"));
    const first = store(prefixing).deviceId();
    const second = store(prefixing).deviceId();

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(second).toBe(first);
    expect(readFileSync(path.join(dir, "device-id"), "utf-8")).toBe(first);
    expect(statSync(path.join(dir, "device-id")).mode.toString(8).slice(-3)).toBe("600");
    expect(readdirSync(dir)).toStrictEqual(["device-id"]);
  });
});
