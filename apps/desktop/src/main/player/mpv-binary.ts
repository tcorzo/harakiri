import path from "node:path";

import { bundledMpv } from "@harakiri/mpv";
import { app } from "electron";

import { env } from "../env";

export interface MpvBinarySources {
  /** HARAKIRI_MPV: a developer's mpv, e.g. a build of mpv master. */
  readonly override: string | undefined;
  readonly packaged: boolean;
  /** process.resourcesPath: the packaged app ships its mpv bundle in <resourcesPath>/mpv. */
  readonly resourcesPath: string;
  /** The checkout's build in .cache/mpv/<recipe-hash>; throws naming `mise run mpv:build` without one. */
  readonly bundled: () => string;
}

/** override ?? (packaged ? <resourcesPath>/mpv/mpv : bundled()). */
export const resolveMpvBinary = (sources: MpvBinarySources): string => {
  if (sources.override !== undefined) {
    return sources.override;
  }

  return sources.packaged ? path.join(sources.resourcesPath, "mpv", "mpv") : sources.bundled();
};

/** The mpv this play runs. Asked per play, so a missing build fails that play, not the app's start. */
export const mpvBinary = (): string =>
  resolveMpvBinary({
    override: env.HARAKIRI_MPV,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    bundled: bundledMpv,
  });
