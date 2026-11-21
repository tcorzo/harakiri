import { app } from "electron";

import { isE2E } from "../env";
import { hostCapabilities } from "../host";
import { loadSession } from "../session";
import { AudioOutputJson, readAudioOutput } from "./audio-output";
import { createPlayer } from "./create-player";
import { preparePlayback, startPlayback } from "./playback";

// Whitespace-split only: e2e passes plain flags such as `--vo=null --ao=pcm --ao-pcm-file=/tmp/x`.
const e2eMpvArgs = (): string[] =>
  isE2E ? (process.env.HARAKIRI_MPV_ARGS ?? "").split(/\s+/u).filter(Boolean) : [];

// e2e describes the output instead of probing the workstation's, e.g. a receiver for passthrough.
const audioOutput = async () => {
  const given = isE2E ? process.env.HARAKIRI_AUDIO_OUTPUT : undefined;

  return given === undefined
    ? await readAudioOutput()
    : await Promise.resolve(AudioOutputJson.parse(JSON.parse(given)));
};

export const { prepare, forgetPrepared, play, stop, probe, isPlaying, mpvPid } = createPlayer({
  loadSession,
  userData: () => app.getPath("userData"),
  extraArgs: e2eMpvArgs,
  audioOutput,
  hdrSignalling: async () => {
    const { hdrSignalling } = await hostCapabilities();

    return hdrSignalling;
  },
  preparePlayback,
  startPlayback,
});
