import { buildPlaybackArgs, bundledMpv, configArg } from "@harakiri/mpv";
import type { AudioPassthrough } from "@harakiri/mpv";

import { runToolOrThrow } from "../process";

export interface AudioOut {
  readonly sampleRate: number;
  readonly channels: number;
  /** mpv's sample format name, `spdif-<codec>` when it chose passthrough. */
  readonly format: string;
}

/**
 * Plays `input` with the player's own `buildPlaybackArgs` argv, overriding only the outputs:
 * ao_pcm writes what would have gone to the audio device into `wavOut`. Returns the output
 * parameters from mpv's `AO:` line, which say whether it chose passthrough at all.
 */
export const captureWithMpv = (
  input: string,
  wavOut: string,
  audioPassthrough?: AudioPassthrough
): AudioOut => {
  const { stdout, stderr } = runToolOrThrow(bundledMpv(), [
    configArg("none"),
    ...buildPlaybackArgs(audioPassthrough === undefined ? {} : { audioPassthrough }),
    "--ao=pcm",
    `--ao-pcm-file=${wavOut}`,
    "--vo=null",
    input,
  ]);

  return parseAudioOutLine(`${stdout}\n${stderr}`);
};

export const parseAudioOutLine = (log: string): AudioOut => {
  const found = /^AO: \[\w+\] (?<rate>\d+)Hz \S+ (?<channels>\d+)ch (?<format>\S+)$/mu.exec(log);

  if (found === null) {
    throw new Error(`mpv printed no AO line:\n${log}`);
  }

  const { rate = "", channels = "", format = "" } = found.groups ?? {};

  return { sampleRate: Number(rate), channels: Number(channels), format };
};
