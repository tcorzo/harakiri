import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AudioOutput, BitstreamCodec } from "@harakiri/fidelity";
import { getLogger } from "@logtape/logtape";
import { z } from "zod";

const logger = getLogger(["harakiri", "player", "audio"]);

/** The bitstream formats PipeWire's pulse layer lists for a sink, as mpv's `--audio-spdif` tokens. */
const CODEC_BY_FORMAT: Readonly<Record<string, BitstreamCodec>> = {
  "ac3-iec61937": "ac3",
  "eac3-iec61937": "eac3",
  "truehd-iec61937": "truehd",
  "dtshd-iec61937": "dts-hd",
  "dts-iec61937": "dts",
};

const ServerInfo = z.object({ default_sink_name: z.string() });
const Sinks = z.array(
  z.object({ name: z.string(), description: z.string().optional(), formats: z.array(z.string()) }),
);

/**
 * The default sink, where mpv's `audio-device=auto` plays, from `pactl --format=json info` and
 * `list sinks`. A sink that lists only `pcm` (analog outputs, headsets, an HDMI port whose
 * passthrough codecs are not enabled in PipeWire) takes no bitstream.
 */
export function outputFromPactl(info: unknown, sinks: unknown): AudioOutput {
  const name = ServerInfo.parse(info).default_sink_name;
  const sink = Sinks.parse(sinks).find((s) => s.name === name);
  if (sink === undefined) return { kind: "unknown", detail: `default sink ${name} is not listed` };
  return {
    kind: "known",
    name: sink.description ?? sink.name,
    bitstream: [...new Set(sink.formats.flatMap((format) => CODEC_BY_FORMAT[format] ?? []))],
  };
}

/** An `AudioOutput` given as JSON, as e2e passes one in place of probing the machine. */
export const AudioOutputJson = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("known"),
    name: z.string(),
    bitstream: z.array(z.enum(["ac3", "eac3", "dts", "dts-hd", "truehd"])),
  }),
  z.object({ kind: z.literal("unknown"), detail: z.string() }),
]) satisfies z.ZodType<AudioOutput>;

const run = promisify(execFile);
const pactl = async (...args: string[]): Promise<unknown> =>
  JSON.parse((await run("pactl", ["--format=json", ...args], { timeout: 2000 })).stdout);

export async function readAudioOutput(): Promise<AudioOutput> {
  let output: AudioOutput;
  try {
    const [info, sinks] = await Promise.all([pactl("info"), pactl("list", "sinks")]);
    output = outputFromPactl(info, sinks);
  } catch (error) {
    output = { kind: "unknown", detail: error instanceof Error ? error.message : String(error) };
  }
  logger.info("Audio output: {output}", { output });
  return output;
}
