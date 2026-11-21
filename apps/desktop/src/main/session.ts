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
  /**
   * Reads a token that builds before the async calls encrypted with the synchronous call, which
   * the async one cannot read. Tried only when the async decryption fails.
   */
  decryptLegacy?: (encrypted: Buffer) => string;
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

/**
 * A session read from disk, whether its token should be encrypted again, and whether it was read
 * through the legacy synchronous call.
 */
interface OpenedSession {
  readonly session: Session;
  readonly reseal: boolean;
  readonly migrated: boolean;
}

/** A token read from disk, before the session around it is checked. */
interface OpenedToken {
  readonly accessToken: string;
  readonly reseal: boolean;
  readonly migrated: boolean;
}

/**
 * Why a session file could not be read, without its content: a JSON.parse error quotes the start
 * of the file, which can be the obfuscated token. A zod error is named by the fields at fault.
 */
const unreadableReason = (error: Error): string => {
  if (error instanceof z.ZodError) {
    const fields = error.issues.map(({ path: at }) =>
      at.length === 0 ? "(root)" : at.map(String).join(".")
    );

    return `${error.name} at ${fields.join(", ")}`;
  }

  return error.name;
};

/**
 * The files under the profile dir. Clearing bumps `generation`, so a save still encrypting when
 * the session is cleared does not bring it back. `keptIn` is where the token last loaded or saved
 * is kept, and clearing forgets it.
 */
interface SessionFiles {
  readonly sessionFile: string;
  readonly write: (file: string, contents: string) => void;
  readonly deviceId: () => DeviceId;
  readonly clear: () => void;
  readonly generation: () => number;
  readonly keptIn: () => SecretStore | undefined;
  readonly keep: (token: StoredToken | undefined) => void;
}

const storeOfToken = (token: StoredToken): SecretStore =>
  match(token.kind)
    .returnType<SecretStore>()
    .with("encrypted", () => "keyring")
    .with("obfuscated", () => "file")
    .exhaustive();

const sessionFiles = (dir: string): SessionFiles => {
  const sessionFile = path.join(dir, "session.json");
  const deviceIdFile = path.join(dir, "device-id");
  let cachedDeviceId: DeviceId | undefined;
  let generation = 0;
  let keptIn: SecretStore | undefined;

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
      keptIn = undefined;
      rmSync(sessionFile, { force: true });
    },
    generation: () => generation,
    keptIn: () => keptIn,
    keep: (token) => {
      keptIn = token === undefined ? undefined : storeOfToken(token);
    },
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

  const openEncrypted = async (encrypted: Buffer): Promise<OpenedToken> => {
    try {
      const { result, shouldReEncrypt } = await crypto.decryptStringAsync(encrypted);

      return { accessToken: result, reseal: shouldReEncrypt, migrated: false };
    } catch (error) {
      if (crypto.decryptLegacy === undefined) {
        throw error;
      }

      return { accessToken: crypto.decryptLegacy(encrypted), reseal: true, migrated: true };
    }
  };

  const openToken = async (token: StoredToken): Promise<OpenedToken> =>
    await match(token)
      .with({ kind: "obfuscated" }, ({ base64 }) => ({
        accessToken: Buffer.from(base64, "base64").toString("utf-8"),
        reseal: false,
        migrated: false,
      }))
      .with(
        { kind: "encrypted" },
        async ({ base64 }) => await openEncrypted(Buffer.from(base64, "base64"))
      )
      .exhaustive();

  const save = async (input: NewSession): Promise<void> => {
    const { accessToken, ...rest } = NewSession.parse(input);
    const generation = files.generation();
    const token = await sealToken(accessToken);

    if (files.generation() === generation) {
      files.write(files.sessionFile, JSON.stringify({ ...rest, token } satisfies StoredSession));
      files.keep(token);
    }
  };

  const load = async (): Promise<Session | null> => {
    // A clear while the token decrypts wins: the load must not bring the session back.
    const generation = files.generation();
    let raw: string;

    try {
      raw = readFileSync(files.sessionFile, "utf-8");
    } catch {
      files.keep(undefined);

      return null;
    }

    let opened: OpenedSession;

    try {
      const { token, ...rest } = StoredSession.parse(JSON.parse(raw));
      const { accessToken, reseal, migrated } = await openToken(token);

      if (files.generation() !== generation) {
        return null;
      }

      opened = {
        session: Session.parse({ ...rest, accessToken, deviceId: files.deviceId() }),
        reseal,
        migrated,
      };
      files.keep(token);
    } catch (error) {
      logger.error("Ignoring unreadable session file {file}: {reason}", {
        file: files.sessionFile,
        reason: error instanceof Error ? unreadableReason(error) : "a thrown non-error",
      });
      files.keep(undefined);

      return null;
    }

    // Only a keyring host encrypts again: on a file host, `save` would move the token to the file.
    if (opened.reseal && secretStore === "keyring") {
      // The token read fine; failing to write it under the new key must not sign the owner out.
      try {
        await save(opened.session);

        if (opened.migrated) {
          logger.info("migrated the saved session to the async keyring format");
        }
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
    // Where the token on disk is, which can differ from what the host offers: a token saved
    // without a keyring stays in the file when a keyring appears. With no session, the host decides.
    storage: () => files.keptIn() ?? secretStore,
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

const electronCrypto: TokenCrypto = {
  encryptStringAsync: async (plain) => await safeStorage.encryptStringAsync(plain),
  decryptStringAsync: async (encrypted) => await safeStorage.decryptStringAsync(encrypted),
  // The only use of the synchronous safeStorage call, which Electron 45 deprecates and Electron 46
  // removes: on KWallet, tokens that earlier builds wrote with it do not decrypt with the async
  // call. Drop this path once Electron 46 lands; those sessions then sign in again.
  // oxlint-disable-next-line typescript/no-deprecated -- the one-time migration of sync-encrypted tokens
  decryptLegacy: (encrypted) => safeStorage.decryptString(encrypted),
};

const electronStore = async (): Promise<SessionStore> => {
  defaultStore ??= hostCapabilities().then(({ secretStore }) =>
    storeOn(electronFiles(), electronCrypto, secretStore)
  );

  return await defaultStore;
};

// Where the token is kept is known only once the store has looked at the file.
let firstLook: Promise<unknown> | undefined;

export const loadSession = async (): Promise<Session | null> => {
  const store = await electronStore();
  const loading = store.load();
  firstLook ??= loading;

  return await loading;
};

export const saveSession = async (session: NewSession): Promise<void> => {
  const store = await electronStore();
  await store.save(session);
};

export const sessionStorage = async (): Promise<SecretStore> => {
  const store = await electronStore();
  firstLook ??= store.load();
  await firstLook;

  return store.storage();
};

export const clearSession = (): void => {
  electronFiles().clear();
};

export const deviceId = (): DeviceId => electronFiles().deviceId();
