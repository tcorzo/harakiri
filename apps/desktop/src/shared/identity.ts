import { DeviceId } from "@harakiri/jellyfin";
import type { ClientIdentity } from "@harakiri/jellyfin";

/** Replaced at build time with apps/desktop/package.json's version, in every bundle and in vitest. */
declare const HARAKIRI_APP_VERSION: string | undefined;

/** harakiri's own version, never Electron's (unpackaged, `app.getVersion()` reports Electron's). */
export const appVersion: string =
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the define is absent outside the bundles, and only typeof tolerates an undeclared global
  typeof HARAKIRI_APP_VERSION === "string" ? HARAKIRI_APP_VERSION : "0.0.0-dev";

/**
 * The one identity the renderer and the player both send with the main process's device id, so the
 * server's dashboard shows one device rather than two clients fighting over the same id.
 */
export const clientIdentity = (deviceId: string): ClientIdentity => ({
  client: "harakiri",
  device: "harakiri desktop",
  deviceId: DeviceId.parse(deviceId),
  version: appVersion,
});
