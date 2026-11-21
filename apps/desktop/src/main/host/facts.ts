import { getLogger } from "@logtape/logtape";

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
 * `GAMESCOPE_*`, `WAYLAND_DISPLAY` and the `safeStorage` backend.
 */
export interface HostFacts extends EnvFacts {
  readonly secretBackend: string;
  readonly encryptionAvailable: boolean;
}

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
