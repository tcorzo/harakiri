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
import { join } from "node:path";

import { afterEach, beforeEach, expect, test } from "vitest";

import { NewSession } from "../shared/bridge";
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
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${plain}`, "utf8"),
  decryptString: (encrypted) => encrypted.toString("utf8").replace(/^enc:/, ""),
  getSelectedStorageBackend: () => "gnome_libsecret",
};

const unavailable: TokenCrypto = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw new Error("unavailable");
  },
  decryptString: () => {
    throw new Error("unavailable");
  },
  getSelectedStorageBackend: () => "unknown",
};

// What Electron reports on Linux with no keyring: "available", but with a hardcoded key.
const basicText: TokenCrypto = { ...prefixing, getSelectedStorageBackend: () => "basic_text" };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "harakiri-session-"));
  writeFileSync(join(dir, "device-id"), DEVICE_ID);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const store = (crypto: TokenCrypto, allowPlaintextToken = false) =>
  createSessionStore({ dir, crypto, allowPlaintextToken });

const readStored = (): unknown => JSON.parse(readFileSync(join(dir, "session.json"), "utf8"));

test("round-trips a session with the token encrypted on disk and main's device id", () => {
  store(prefixing).save(newSession);

  expect(readStored()).toEqual({
    serverUrl: "http://127.0.0.1:8096/",
    serverId: "server-1",
    serverName: "Dev",
    serverVersion: "10.11.0",
    userId: USER_ID,
    userName: "harakiri",
    token: { kind: "encrypted", base64: Buffer.from("enc:secret-token").toString("base64") },
  });
  expect(store(prefixing).load()).toEqual(expectedSession);
});

test("a device id smuggled into the payload is replaced by main's", () => {
  store(prefixing).save({ ...newSession, deviceId: "renderer-made" } as typeof newSession);

  expect(store(prefixing).load()?.deviceId).toBe(DEVICE_ID);
});

test("clear removes the stored session", () => {
  const s = store(prefixing);
  s.save(newSession);
  s.clear();

  expect(s.load()).toBeNull();
  expect(store(prefixing).load()).toBe(null);
});

test("a corrupt file loads as null", () => {
  writeFileSync(join(dir, "session.json"), "{not json");

  expect(store(prefixing).load()).toBe(null);
});

test("an undecryptable token loads as null", () => {
  store(prefixing).save(newSession);

  const locked: TokenCrypto = {
    ...prefixing,
    decryptString: () => {
      throw new Error("keyring changed");
    },
  };

  expect(store(locked).load()).toBe(null);
});

test("without a keyring the e2e store keeps the token in plain text", () => {
  store(unavailable, true).save(newSession);

  expect(readStored()).toMatchObject({ token: { kind: "plain", value: "secret-token" } });
  expect(store(unavailable, true).load()).toEqual(expectedSession);
});

test("without a keyring outside e2e the session lives in memory only", () => {
  const s = store(unavailable);
  s.save(newSession);

  expect(s.load()).toEqual(expectedSession);
  expect(() => readFileSync(join(dir, "session.json"))).toThrow(/ENOENT/);
  expect(store(unavailable).load()).toBe(null);
});

test("the basic_text backend counts as no keyring: nothing is written", () => {
  const s = store(basicText);
  s.save(newSession);

  expect(s.load()).toEqual(expectedSession);
  expect(readdirSync(dir)).toEqual(["device-id"]);
});

test("a save replaces an existing file atomically with mode 0600 and leaves no temp file", () => {
  writeFileSync(join(dir, "session.json"), "{}");
  chmodSync(join(dir, "session.json"), 0o644);

  store(prefixing).save(newSession);

  expect(readdirSync(dir).toSorted()).toEqual(["device-id", "session.json"]);
  expect(statSync(join(dir, "session.json")).mode & 0o777).toBe(0o600);
  expect(store(prefixing).load()).toEqual(expectedSession);
});

test("the device id is generated once, survives a restart and is written 0600", () => {
  rmSync(join(dir, "device-id"));
  const first = store(prefixing).deviceId();
  const second = store(prefixing).deviceId();

  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(second).toBe(first);
  expect(readFileSync(join(dir, "device-id"), "utf8")).toBe(first);
  expect(statSync(join(dir, "device-id")).mode & 0o777).toBe(0o600);
  expect(readdirSync(dir)).toEqual(["device-id"]);
});
