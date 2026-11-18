import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AudioPassthrough } from "@harakiri/mpv";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { muxSpdif, sha256, synthesizeClip } from "./clips";
import type { Clip, ClipCodec } from "./clips";
import { elementaryStream, scanBursts } from "./iec61937";
import type { Burst } from "./iec61937";
import { captureWithMpv } from "./mpv-capture";
import { readPcm16, WavError } from "./wav";

let dir: string;
const clips = new Map<ClipCodec, Clip>();

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "harness-t1-"));

  for (const codec of ["ac3", "eac3", "dts", "truehd"] as const) {
    clips.set(codec, synthesizeClip(dir, codec));
  }
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function clip(codec: ClipCodec): Clip {
  const found = clips.get(codec);

  if (found === undefined) {
    throw new Error(`clip ${codec} was not synthesized`);
  }

  return found;
}

function capture(codec: ClipCodec, audioPassthrough?: AudioPassthrough) {
  const wav = join(dir, `${codec}-mpv.wav`);
  const ao = captureWithMpv(clip(codec).mkv, wav, audioPassthrough);
  const pcm = readPcm16(readFileSync(wav));
  const reference = join(dir, `${codec}-ffmpeg.spdif`);
  muxSpdif(clip(codec).mkv, reference);

  return {
    ao,
    pcm,
    spdifReference: readPcm16(readFileSync(reference)).data,
    source: readFileSync(clip(codec).reference),
  };
}

const kinds = (bursts: readonly Burst[]) => [
  ...new Set(bursts.map((b) => `${b.dataType}/${b.subtype}`)),
];

describe("T1: the player's mpv argv writes the IEC 61937 stream unmodified", () => {
  test.each([
    { codec: "ac3", ao: { sampleRate: 48_000, channels: 2, format: "spdif-ac3" } },
    { codec: "dts", ao: { sampleRate: 48_000, channels: 2, format: "spdif-dts" } },
    { codec: "truehd", ao: { sampleRate: 192_000, channels: 8, format: "spdif-truehd" } },
  ] as const)("$codec capture equals FFmpeg's spdif output byte for byte", ({ codec, ao }) => {
    const run = capture(codec);
    expect(run.ao).toEqual(ao);
    expect(run.pcm.kind).toBe("wav");
    expect(sha256(run.pcm.data)).toBe(sha256(run.spdifReference));
  });

  test("ac3 and dts captures unwrap to the source elementary stream", () => {
    for (const codec of ["ac3", "dts"] as const) {
      const run = capture(codec);
      expect(sha256(elementaryStream(scanBursts(run.pcm.data)).bytes)).toBe(sha256(run.source));
    }
  });

  // Observed with mpv 0.41.0 / FFmpeg 8.1.3: from Matroska, mpv emits every E-AC-3 burst
  // except the last (the same .eac3 file played raw loses nothing). The bytes it does emit
  // are identical, so the tolerance is at most one trailing burst.
  test("eac3 capture is FFmpeg's spdif output, at most its final burst short", () => {
    const run = capture("eac3");
    expect(run.ao).toEqual({ sampleRate: 192_000, channels: 2, format: "spdif-eac3" });
    const reference = scanBursts(run.spdifReference);
    const captured = scanBursts(run.pcm.data);
    expect([kinds(captured), kinds(reference)]).toEqual([["21/0"], ["21/0"]]);

    const [first, second] = reference;

    if (first === undefined || second === undefined) {
      throw new Error("fewer than two bursts");
    }
    const missing = run.spdifReference.length - run.pcm.data.length;
    expect([0, second.offset - first.offset]).toContain(missing);
    expect(sha256(run.pcm.data)).toBe(sha256(run.spdifReference.subarray(0, run.pcm.data.length)));

    expect(sha256(elementaryStream(reference).bytes)).toBe(sha256(run.source));
    expect(sha256(elementaryStream(captured).bytes)).toBe(
      sha256(elementaryStream(reference.slice(0, captured.length)).bytes)
    );
  });

  test("without the codec in --audio-spdif mpv decodes to float PCM, which the harness refuses", () => {
    const wav = join(dir, "dts-decoded.wav");
    expect(captureWithMpv(clip("dts").mkv, wav, ["ac3"])).toEqual({
      sampleRate: 48_000,
      channels: 6,
      format: "float",
    });
    expect(() => readPcm16(readFileSync(wav))).toThrow(
      new WavError("fmt has 32 bits per sample, IEC 61937 needs 16")
    );
  });
});
