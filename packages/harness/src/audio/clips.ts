import { createHash } from "node:crypto";
import path from "node:path";

import { runToolOrThrow } from "../process";

export type ClipCodec = "ac3" | "eac3" | "dts" | "truehd";

/** FFmpeg encoder arguments and the raw muxer that writes the bare elementary stream. */
const CLIP_CODECS = {
  ac3: { encode: ["-c:a", "ac3", "-b:a", "384k"], rawFormat: "ac3" },
  eac3: { encode: ["-c:a", "eac3", "-b:a", "640k"], rawFormat: "eac3" },
  dts: { encode: ["-c:a", "dca", "-strict", "-2"], rawFormat: "dts" },
  truehd: { encode: ["-c:a", "truehd", "-strict", "-2"], rawFormat: "truehd" },
} as const satisfies Record<ClipCodec, { encode: readonly string[]; rawFormat: string }>;

const SINE_5_1 = [
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000:duration=2",
  "-ac",
  "6",
];

export interface Clip {
  readonly codec: ClipCodec;
  /** 2 s 5.1 48 kHz sine encoded with `codec`, in Matroska. */
  readonly mkv: string;
  /** The same elementary stream, stream-copied out of `mkv` with no container. */
  readonly reference: string;
}

export const synthesizeClip = (dir: string, codec: ClipCodec): Clip => {
  const { encode, rawFormat } = CLIP_CODECS[codec];
  const mkv = path.join(dir, `${codec}.mkv`);
  const reference = path.join(dir, `${codec}.${rawFormat}`);
  ffmpeg([...SINE_5_1, ...encode, mkv]);
  ffmpeg(["-i", mkv, "-map", "0:a:0", "-c", "copy", "-f", rawFormat, reference]);

  return { codec, mkv, reference };
};

/** A plain 16-bit PCM sine WAV: audio that carries no IEC 61937 bursts. */
export const synthesizePcmWav = (dir: string): string => {
  const wav = path.join(dir, "pcm-sine.wav");
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=2",
    "-ac",
    "2",
    "-c:a",
    "pcm_s16le",
    wav,
  ]);

  return wav;
};

/**
 * Packs a track with FFmpeg's spdif muxer, the same libavformat code mpv's ad_spdif calls.
 * `dtshdRate` selects DTS type IV output (mpv uses 768000 for DTS-HD MA).
 */
export const muxSpdif = (
  input: string,
  output: string,
  options: { dtshdRate?: number } = {}
): void => {
  const dtshd = options.dtshdRate === undefined ? [] : ["-dtshd_rate", String(options.dtshdRate)];
  ffmpeg(["-i", input, "-map", "0:a:0", "-c", "copy", "-f", "spdif", ...dtshd, output]);
};

export const remuxToMatroska = (input: string, output: string): void => {
  ffmpeg(["-i", input, "-map", "0:a:0", "-c", "copy", output]);
};

export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const ffmpeg = (args: readonly string[]): void => {
  runToolOrThrow("ffmpeg", ["-v", "error", "-nostdin", "-y", ...args]);
};
