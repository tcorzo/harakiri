import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import { DeviceId } from "@harakiri/jellyfin";
import { getLogger } from "@logtape/logtape";
import { app, safeStorage } from "electron";
import { match } from "ts-pattern";
import { z } from "zod";

import { NewSession, Session } from "../shared/bridge";
import { hostCapabilities } from "./host";
import type { SecretStore } from "./host";

const logger = getLogger(["harakiri", "session"]);

/** The slice of Electron's safeStorage the store needs, so tests can supply their own. */
export interface TokenCrypto {
  encryptStringAsync: (plain: string) => Promise<Buffer>;
  decryptStringAsync: (encrypted: Buffer) => Promise<{ result: string; shouldReEncrypt: boolean }>;
}

export interface SessionStoreOptions {
  dir: string;
  crypto: TokenCrypto;
  /** Where a new token goes: encrypted by the keyring, or obfuscated in the 0600 file. */
  secretStore: SecretStore;
}

export interface SessionStore {
  load: () => Promise<Session | null>;
  save: (session: NewSession) => Promise<void>;
  clear: () => void;
  deviceId: () => DeviceId;
  storage: () => SecretStore;
}

// `obfuscated` is base64 of the UTF-8 token: it only keeps the token out of a casual glance, and
// the file's 0600 mode is what protects it.
const StoredToken = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("encrypted"), base64: z.string().min(1) }),
  z.object({ kind: z.literal("obfuscated"), base64: z.string().min(1) }),
]);

type StoredToken = z.infer<typeof StoredToken>;

const StoredSession = Session.omit({ accessToken: true, deviceId: true }).extend({
  token: StoredToken,
});

type StoredSession = z.infer<typeof StoredSession>;

/** A session read from disk, and whether Electron asked for its token to be encrypted again. */
interface OpenedSession {
  readonly session: Session;
  readonly reseal: boolean;
}

/**
 * The files under the profile dir. Clearing bumps `generation`, so a save still encrypting when
 * the session is cleared does not bring it back.
 */
interface SessionFiles {
  readonly sessionFile: string;
  readonly write: (file: string, contents: string) => void;
  readonly deviceId: () => DeviceId;
  readonly clear: () => void;
  readonly generation: () => number;
}

const sessionFiles = (dir: string): SessionFiles => {
  const sessionFile = path.join(dir, "session.json");
  const deviceIdFile = path.join(dir, "device-id");
  let cachedDeviceId: DeviceId | undefined;
  let generation = 0;

  // A crash mid-write must leave the previous file, never a truncated one; the rename also
  // replaces whatever mode an existing file had with the temp file's 0600.
  const write = (file: string, contents: string): void => {
    mkdirSync(dir, { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;

    try {
      const fd = openSync(temp, "wx", 0o600);

      try {
        writeSync(fd, contents);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }

      renameSync(temp, file);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  };

  const deviceId = (): DeviceId => {
    if (cachedDeviceId !== undefined) {
      return cachedDeviceId;
    }

    try {
      cachedDeviceId = DeviceId.parse(z.uuid().parse(readFileSync(deviceIdFile, "utf-8").trim()));
    } catch {
      cachedDeviceId = DeviceId.parse(randomUUID());
      write(deviceIdFile, cachedDeviceId);
    }

    return cachedDeviceId;
  };

  return {
    sessionFile,
    write,
    deviceId,
    clear: () => {
      generation += 1;
      rmSync(sessionFile, { force: true });
    },
    generation: () => generation,
  };
};

const storeOn = (
  files: SessionFiles,
  crypto: TokenCrypto,
  secretStore: SecretStore
): SessionStore => {
  let saidWhere = false;

  const sealToken = async (accessToken: string): Promise<StoredToken> => {
    if (secretStore === "keyring") {
      const encrypted = await crypto.encryptStringAsync(accessToken);

      return { kind: "encrypted", base64: encrypted.toString("base64") };
    }

    if (!saidWhere) {
      saidWhere = true;
      logger.info("No keyring: the session is kept in {file}, readable only by this user", {
        file: files.sessionFile,
      });
    }

    return { kind: "obfuscated", base64: Buffer.from(accessToken, "utf-8").toString("base64") };
  };

  const openToken = async (token: StoredToken): Promise<{ accessToken: string; reseal: boolean }> =>
    await match(token)
      .with({ kind: "obfuscated" }, ({ base64 }) => ({
        accessToken: Buffer.from(base64, "base64").toString("utf-8"),
        reseal: false,
      }))
      .with({ kind: "encrypted" }, async ({ base64 }) => {
        const { result, shouldReEncrypt } = await crypto.decryptStringAsync(
          Buffer.from(base64, "base64")
        );

        return { accessToken: result, reseal: shouldReEncrypt };
      })
      .exhaustive();

  const save = async (input: NewSession): Promise<void> => {
    const { accessToken, ...rest } = NewSession.parse(input);
    const generation = files.generation();
    const token = await sealToken(accessToken);

    if (files.generation() === generation) {
      files.write(files.sessionFile, JSON.stringify({ ...rest, token } satisfies StoredSession));
    }
  };

  const load = async (): Promise<Session | null> => {
    let raw: string;

    try {
      raw = readFileSync(files.sessionFile, "utf-8");
    } catch {
      return null;
    }

    let opened: OpenedSession;

    try {
      const { token, ...rest } = StoredSession.parse(JSON.parse(raw));
      const { accessToken, reseal } = await openToken(token);
      opened = {
        session: Session.parse({ ...rest, accessToken, deviceId: files.deviceId() }),
        reseal,
      };
    } catch (error) {
      logger.error("Ignoring unreadable session file {file}: {error}", {
        file: files.sessionFile,
        error,
      });

      return null;
    }

    if (opened.reseal) {
      // The token read fine; failing to write it under the new key must not sign the owner out.
      try {
        await save(opened.session);
      } catch (error) {
        logger.warn("Could not re-encrypt the session in {file}: {error}", {
          file: files.sessionFile,
          error,
        });
      }
    }

    return opened.session;
  };

  return {
    load,
    save,
    clear: files.clear,
    deviceId: files.deviceId,
    storage: () => secretStore,
  };
};

export const createSessionStore = (options: SessionStoreOptions): SessionStore =>
  storeOn(sessionFiles(options.dir), options.crypto, options.secretStore);

// The device id and clearing need no keyring, so they stay synchronous; only the store that
// seals tokens waits for the host to say where secrets go, which it knows after `app.whenReady()`.
let defaultFiles: SessionFiles | undefined;
let defaultStore: Promise<SessionStore> | undefined;

const electronFiles = (): SessionFiles => {
  defaultFiles ??= sessionFiles(app.getPath("userData"));

  return defaultFiles;
};

const electronStore = async (): Promise<SessionStore> => {
  defaultStore ??= hostCapabilities().then(({ secretStore }) =>
    storeOn(electronFiles(), safeStorage, secretStore)
  );

  return await defaultStore;
};

export const loadSession = async (): Promise<Session | null> => {
  const store = await electronStore();

  return await store.load();
};

export const saveSession = async (session: NewSession): Promise<void> => {
  const store = await electronStore();
  await store.save(session);
};

export const sessionStorage = async (): Promise<SecretStore> => {
  const store = await electronStore();

  return store.storage();
};

export const clearSession = (): void => {
  electronFiles().clear();
};

export const deviceId = (): DeviceId => electronFiles().deviceId();
