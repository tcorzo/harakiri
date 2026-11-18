import { readFileSync } from "node:fs";

import type { MediaSourceInfo, PlaybackInfoResponse } from "@harakiri/jellyfin/generated";
import { zMediaSourceInfo, zPlaybackInfoResponse } from "@harakiri/jellyfin/generated/zod";
import { z } from "zod";

// The generated schema reads tick counts as bigint, so they are read as plain numbers here.
const Fixture = zPlaybackInfoResponse.extend({
  MediaSources: z
    .array(
      zMediaSourceInfo
        .pick({
          Id: true,
          MediaStreams: true,
          DefaultAudioStreamIndex: true,
          DefaultSubtitleStreamIndex: true,
          TranscodingUrl: true,
          SupportsDirectPlay: true,
        })
        .extend({ RunTimeTicks: z.number().nullish() })
    )
    .optional(),
});

export type FixtureName =
  | "dv-hdr10-truehd-atmos"
  | "dv5-eac3"
  | "dv7-el-dtshd"
  | "dv-hdr10plus-eac3-atmos"
  | "hdr10-truehd-atmos"
  | "hdr10plus-dtshd"
  | "sdr-dtsx"
  | "sdr-aac"
  | "sdr-pcm"
  | "sdr-av1-opus"
  | "transcode-bitrate";

/** A PlaybackInfo response recorded from the dev Jellyfin by `record.ts`. */
export const playbackInfo = (name: FixtureName): PlaybackInfoResponse =>
  Fixture.parse(JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8")));

export const mediaSource = (name: FixtureName): MediaSourceInfo => {
  const first = playbackInfo(name).MediaSources?.[0];

  if (!first) {
    throw new Error(`fixture ${name} has no media source`);
  }

  return first;
};
