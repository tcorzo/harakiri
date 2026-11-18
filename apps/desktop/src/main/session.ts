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
import { join } from "node:path";

import { DeviceId } from "@harakiri/jellyfin";
import { getLogger } from "@logtape/logtape";
import { app, safeStorage } from "electron";
import { z } from "zod";

import { NewSession, Session } from "../shared/bridge";
import { isE2E } from "./env";

const logger = getLogger(["harakiri", "session"]);

/** The slice of Electron's safeStorage the store needs, so tests can supply their own. */
export interface TokenCrypto {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** Linux only. `basic_text` means a hardcoded key: obfuscation, not encryption. */
  getSelectedStorageBackend(): string;
}

export interface SessionStoreOptions {
  dir: string;
  crypto: TokenCrypto;
  /** Store the token unencrypted when the keyring is unavailable. Only e2e runs allow it. */
  allowPlaintextToken: boolean;
}

export interface SessionStore {
  load(): Session | null;
  save(session: NewSession): void;
  clear(): void;
  deviceId(): DeviceId;
}

const StoredToken = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("encrypted"), base64: z.string().min(1) }),
  z.object({ kind: z.literal("plain"), value: z.string().min(1) }),
]);

const StoredSession = Session.omit({ accessToken: true, deviceId: true }).extend({
  token: StoredToken,
});
type StoredSession = z.infer<typeof StoredSession>;

export function createSessionStore(options: SessionStoreOptions): SessionStore {
  const sessionFile = join(options.dir, "session.json");
  const deviceIdFile = join(options.dir, "device-id");
  let memorySession: Session | null = null;
  let cachedDeviceId: DeviceId | undefined;

  // A crash mid-write must leave the previous file, never a truncated one; the rename also
  // replaces whatever mode an existing file had with the temp file's 0600.
  function write(file: string, contents: string): void {
    mkdirSync(options.dir, { recursive: true });
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
  }

  function encryptionUsable(): boolean {
    return (
      options.crypto.isEncryptionAvailable() &&
      options.crypto.getSelectedStorageBackend() !== "basic_text"
    );
  }

  function deviceId(): DeviceId {
    if (cachedDeviceId !== undefined) return cachedDeviceId;
    try {
      cachedDeviceId = DeviceId.parse(z.uuid().parse(readFileSync(deviceIdFile, "utf8").trim()));
    } catch {
      cachedDeviceId = DeviceId.parse(randomUUID());
      write(deviceIdFile, cachedDeviceId);
    }
    return cachedDeviceId;
  }

  function readToken(token: StoredSession["token"]): string {
    if (token.kind === "plain") return token.value;
    return options.crypto.decryptString(Buffer.from(token.base64, "base64"));
  }

  return {
    load() {
      if (memorySession !== null) return memorySession;
      let raw: string;
      try {
        raw = readFileSync(sessionFile, "utf8");
      } catch {
        return null;
      }
      try {
        const { token, ...rest } = StoredSession.parse(JSON.parse(raw));
        return Session.parse({ ...rest, accessToken: readToken(token), deviceId: deviceId() });
      } catch (error) {
        logger.error("Ignoring unreadable session file {file}: {error}", {
          file: sessionFile,
          error,
        });
        return null;
      }
    },

    save(input) {
      const { accessToken, ...rest } = NewSession.parse(input);
      let token: StoredSession["token"];
      if (encryptionUsable()) {
        token = {
          kind: "encrypted",
          base64: options.crypto.encryptString(accessToken).toString("base64"),
        };
      } else if (options.allowPlaintextToken) {
        token = { kind: "plain", value: accessToken };
      } else {
        logger.warn(
          "safeStorage has no keyring (backend {backend}); the session is kept in memory and will not survive a restart",
          { backend: options.crypto.getSelectedStorageBackend() }
        );
        memorySession = { ...rest, accessToken, deviceId: deviceId() };
        rmSync(sessionFile, { force: true });
        return;
      }
      memorySession = null;
      write(sessionFile, JSON.stringify({ ...rest, token } satisfies StoredSession));
    },

    clear() {
      memorySession = null;
      rmSync(sessionFile, { force: true });
    },

    deviceId,
  };
}

let defaultStore: SessionStore | undefined;

function electronStore(): SessionStore {
  defaultStore ??= createSessionStore({
    dir: app.getPath("userData"),
    crypto: safeStorage,
    allowPlaintextToken: isE2E,
  });
  return defaultStore;
}

export const loadSession = (): Session | null => electronStore().load();
export const saveSession = (session: NewSession): void => electronStore().save(session);
export const clearSession = (): void => electronStore().clear();
export const deviceId = (): DeviceId => electronStore().deviceId();
