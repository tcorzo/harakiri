import { readdir, realpath } from "node:fs/promises";
import path from "node:path";

import { getLogger } from "@logtape/logtape";

import { readShortcuts } from "./steam/shortcuts-vdf";
import type { Shortcut } from "./steam/shortcuts-vdf";

const logger = getLogger(["harakiri", "host"]);

/** What the secret store reports, as Electron's `safeStorage` does after `app.whenReady()`. */
export interface SecretProbe {
  getSelectedStorageBackend: () => string;
  isAsyncEncryptionAvailable: () => Promise<boolean>;
}

/** The facts the environment holds, read without asking the secret store. */
export interface EnvFacts {
  /** `GAMESCOPE_WAYLAND_DISPLAY`. */
  readonly gamescopeDisplay: string | undefined;
  /** `WAYLAND_DISPLAY`. */
  readonly waylandDisplay: string | undefined;
  /** `XDG_CURRENT_DESKTOP` split on ":", empty entries dropped. */
  readonly desktop: readonly string[];
}

/**
 * What the machine harakiri runs on is, read once. This module is the only reader of `XDG_*`,
 * `GAMESCOPE_*`, `WAYLAND_DISPLAY` and the `safeStorage` backend. It also reads where Steam keeps
 * its user data (`readSteamFacts`), on every call, because that changes while harakiri runs.
 */
export interface HostFacts extends EnvFacts {
  readonly secretBackend: string;
  readonly encryptionAvailable: boolean;
}

/** A Steam account's data under `userdata/<id>`. */
export interface SteamUser {
  /** The `userdata/<id>` directory name, all digits. */
  readonly id: string;
  /** `<root>/userdata/<id>/config/grid` (may not exist yet). */
  readonly gridDir: string;
  readonly shortcuts: readonly Shortcut[];
}

/** Where Steam keeps its user data, if it is installed. */
export interface SteamFacts {
  /** Realpath of the first candidate with a `userdata/` directory. */
  readonly root: string | undefined;
  /** Sorted by numeric id. */
  readonly users: readonly SteamUser[];
}

const noSteam: SteamFacts = { root: undefined, users: [] };

/** Candidates in order: `$HOME/.local/share/Steam`, then `$HOME/.steam/steam`. No HOME, no root. */
export const steamRoots = (home: string): readonly string[] =>
  home === ""
    ? []
    : [path.join(home, ".local", "share", "Steam"), path.join(home, ".steam", "steam")];

const isMissing = (error: Error): boolean =>
  "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");

/** The names in a directory; a missing directory is `undefined`, other IO errors reject. */
const listDirectory = async (directory: string): Promise<string[] | undefined> => {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error instanceof Error && isMissing(error)) {
      return undefined;
    }

    throw error;
  }
};

/** The realpath of a candidate that holds a `userdata/` directory, else `undefined`. */
const rootIfSteam = async (candidate: string): Promise<string | undefined> => {
  try {
    const root = await realpath(candidate);

    return (await listDirectory(path.join(root, "userdata"))) === undefined ? undefined : root;
  } catch (error) {
    if (error instanceof Error && isMissing(error)) {
      return undefined;
    }

    throw error;
  }
};

/** The first candidate with a `userdata/` directory, in candidate order. */
const findSteamRoot = async (candidates: readonly string[]): Promise<string | undefined> => {
  const roots = await Promise.all(candidates.map(rootIfSteam));

  return roots.find((root) => root !== undefined);
};

const readSteamUser = async (root: string, id: string): Promise<SteamUser | undefined> => {
  const config = path.join(root, "userdata", id, "config");

  if ((await listDirectory(config)) === undefined) {
    return undefined;
  }

  return {
    id,
    gridDir: path.join(config, "grid"),
    shortcuts: await readShortcuts(path.join(config, "shortcuts.vdf")),
  };
};

/** Reads the disk on every call: the user adds the shortcut while harakiri runs. Never rejects. */
export const readSteamFacts = async (
  env: Readonly<Record<string, string | undefined>>
): Promise<SteamFacts> => {
  try {
    const root = await findSteamRoot(steamRoots(env.HOME ?? ""));

    if (root === undefined) {
      return noSteam;
    }

    const names = (await listDirectory(path.join(root, "userdata"))) ?? [];

    const ids = names
      .filter((name) => /^\d+$/u.test(name))
      .toSorted((a, b) => Number(a) - Number(b));

    const read = await Promise.all(ids.map(async (id) => await readSteamUser(root, id)));

    const users = read.filter((user) => user !== undefined);

    return { root, users };
  } catch (error) {
    logger.warn("Steam's user data could not be read: {error}", { error });

    return noSteam;
  }
};

const unsetIfEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value;

export const readEnvFacts = (env: Readonly<Record<string, string | undefined>>): EnvFacts => ({
  gamescopeDisplay: unsetIfEmpty(env.GAMESCOPE_WAYLAND_DISPLAY),
  waylandDisplay: unsetIfEmpty(env.WAYLAND_DISPLAY),
  desktop: (env.XDG_CURRENT_DESKTOP ?? "").split(":").filter((entry) => entry !== ""),
});

const probeSecrets = async (
  secrets: SecretProbe
): Promise<Pick<HostFacts, "secretBackend" | "encryptionAvailable">> => ({
  secretBackend: secrets.getSelectedStorageBackend(),
  encryptionAvailable: await secrets.isAsyncEncryptionAvailable(),
});

/**
 * Never rejects: a failed probe (a locked KWallet, a Secret Service that does not answer) reads as
 * no keyring, so the session goes to the file and Settings says so.
 */
const probeSecretsSafely = async (
  secrets: SecretProbe
): Promise<Pick<HostFacts, "secretBackend" | "encryptionAvailable">> => {
  try {
    return await probeSecrets(secrets);
  } catch (error) {
    logger.warn("The secret store did not answer, so secrets go to a file: {error}", { error });

    return { secretBackend: "unknown", encryptionAvailable: false };
  }
};

/** Never rejects; see `probeSecretsSafely`. */
export const readHostFacts = async (
  env: Readonly<Record<string, string | undefined>>,
  secrets: SecretProbe
): Promise<HostFacts> => ({ ...readEnvFacts(env), ...(await probeSecretsSafely(secrets)) });
