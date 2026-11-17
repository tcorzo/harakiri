import { type ClientIdentity, DeviceId } from "@harakiri/jellyfin";

/** Replaced at build time with apps/desktop/package.json's version, in every bundle and in vitest. */
declare const HARAKIRI_APP_VERSION: string | undefined;

/** harakiri's own version, never Electron's (unpackaged, `app.getVersion()` reports Electron's). */
export const appVersion: string =
  typeof HARAKIRI_APP_VERSION === "string" ? HARAKIRI_APP_VERSION : "0.0.0-dev";

/**
 * The one identity the renderer and the player both send with the main process's device id, so the
 * server's dashboard shows one device rather than two clients fighting over the same id.
 */
export function clientIdentity(deviceId: string): ClientIdentity {
  return {
    client: "harakiri",
    device: "harakiri desktop",
    deviceId: DeviceId.parse(deviceId),
    version: appVersion,
  };
}
