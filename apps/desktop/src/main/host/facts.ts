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

// Contract stub: Task 5 of the plan replaces this body with the real reading.
export const readHostFacts = async (
  _env: Readonly<Record<string, string | undefined>>,
  _secrets: SecretProbe
): Promise<HostFacts> =>
  await Promise.resolve({
    gamescopeDisplay: undefined,
    waylandDisplay: undefined,
    desktop: [],
    secretBackend: "unknown",
    encryptionAvailable: false,
  });
