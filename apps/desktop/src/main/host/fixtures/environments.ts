import type { SecretProbe } from "../facts";

/** Steam Game Mode (gamescope session): an X11 session with gamescope's own Wayland display. */
export const gamescopeSession = {
  XDG_CURRENT_DESKTOP: "gamescope",
  XDG_SESSION_TYPE: "x11",
  DISPLAY: ":1",
  ENABLE_GAMESCOPE_WSI: "1",
  GAMESCOPE_WAYLAND_DISPLAY: "gamescope-0",
};

/** A Plasma Wayland desktop session. */
export const plasmaWayland = {
  XDG_CURRENT_DESKTOP: "KDE",
  XDG_SESSION_TYPE: "wayland",
  WAYLAND_DISPLAY: "wayland-0",
};

export const secrets = (backend: string, available: boolean): SecretProbe => ({
  getSelectedStorageBackend: () => backend,
  isAsyncEncryptionAvailable: async () => await Promise.resolve(available),
});
