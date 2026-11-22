import { bundledMpv } from "@harakiri/mpv";
import { app } from "electron";

import { env } from "../env";

export interface MpvBinarySources {
  /** HARAKIRI_MPV: a developer's mpv, e.g. a build of mpv master. */
  readonly override: string | undefined;
  readonly packaged: boolean;
  /** The checkout's build in .cache/mpv/<recipe-hash>; throws naming `mise run mpv:build` without one. */
  readonly bundled: () => string;
}

/** override ?? (packaged ? "mpv" : bundled()). Phase 8: packaged → <resourcesPath>/mpv/mpv. */
export const resolveMpvBinary = (sources: MpvBinarySources): string => {
  if (sources.override !== undefined) {
    return sources.override;
  }

  return sources.packaged ? "mpv" : sources.bundled();
};

/** The mpv this play runs. Asked per play, so a missing build fails that play, not the app's start. */
export const mpvBinary = (): string =>
  resolveMpvBinary({ override: env.HARAKIRI_MPV, packaged: app.isPackaged, bundled: bundledMpv });
