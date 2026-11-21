/** What the secret store reports, as Electron's `safeStorage` does after `app.whenReady()`. */
export interface SecretProbe {
  getSelectedStorageBackend: () => string;
  isAsyncEncryptionAvailable: () => Promise<boolean>;
}

/**
 * What the machine harakiri runs on is, read once. This module is the only reader of `XDG_*`,
 * `GAMESCOPE_*`, `WAYLAND_DISPLAY` and the `safeStorage` backend.
 */
export interface HostFacts {
  /** `GAMESCOPE_WAYLAND_DISPLAY`. */
  readonly gamescopeDisplay: string | undefined;
  /** `WAYLAND_DISPLAY`. */
  readonly waylandDisplay: string | undefined;
  /** `XDG_CURRENT_DESKTOP` split on ":", empty entries dropped. */
  readonly desktop: readonly string[];
  readonly secretBackend: string;
  readonly encryptionAvailable: boolean;
}

const unsetIfEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value;

export const readHostFacts = async (
  env: Readonly<Record<string, string | undefined>>,
  secrets: SecretProbe
): Promise<HostFacts> => ({
  gamescopeDisplay: unsetIfEmpty(env.GAMESCOPE_WAYLAND_DISPLAY),
  waylandDisplay: unsetIfEmpty(env.WAYLAND_DISPLAY),
  desktop: (env.XDG_CURRENT_DESKTOP ?? "").split(":").filter((entry) => entry !== ""),
  secretBackend: secrets.getSelectedStorageBackend(),
  encryptionAvailable: await secrets.isAsyncEncryptionAvailable(),
});
