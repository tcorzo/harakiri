import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { expectShortByAtMostOneMatFrame } from "./assertions";
import {
  type Clip,
  type ClipCodec,
  muxSpdif,
  sha256,
  synthesizeClip,
  synthesizePcmWav,
} from "./clips";
import { elementaryStream, Iec61937Error, scanBursts } from "./iec61937";
import { readPcm16 } from "./wav";

let dir: string;
const clips = new Map<ClipCodec, Clip>();

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "harness-t0-"));

  for (const codec of ["ac3", "eac3", "dts", "truehd"] as const) {
    clips.set(codec, synthesizeClip(dir, codec));
  }
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function clip(codec: ClipCodec): Clip {
  const found = clips.get(codec);

  if (found === undefined) {
    throw new Error(`clip ${codec} was not synthesized`);
  }

  return found;
}

function spdifOf(codec: ClipCodec, options: { dtshdRate?: number } = {}): Uint8Array {
  const out = join(dir, `${codec}-${options.dtshdRate ?? "plain"}.spdif`);
  muxSpdif(clip(codec).mkv, out, options);

  return readPcm16(readFileSync(out)).data;
}

function summarize(pcm: Uint8Array) {
  const bursts = scanBursts(pcm);
  const kinds = [...new Set(bursts.map((b) => `${b.dataType}/${b.subtype}`))];

  return { bursts, kinds, stream: elementaryStream(bursts) };
}

describe("T0: FFmpeg spdif muxer round trip through the extractor", () => {
  test.each([
    { codec: "ac3", kind: "1/0" },
    { codec: "eac3", kind: "21/0" },
    { codec: "dts", kind: "11/0" },
  ] as const)("$codec bursts carry the source stream byte for byte", ({ codec, kind }) => {
    const { kinds, stream } = summarize(spdifOf(codec));
    expect(kinds).toEqual([kind]);
    expect(stream.codec).toBe(codec);
    expect(sha256(stream.bytes)).toBe(sha256(readFileSync(clip(codec).reference)));
  });

  test("DTS core wrapped as type IV at mpv's 768 kHz rate uses subtype 4 and keeps every byte", () => {
    const { bursts, kinds, stream } = summarize(spdifOf("dts", { dtshdRate: 768_000 }));
    expect(kinds).toEqual(["17/4"]);
    expect(bursts.length).toBe(summarize(spdifOf("dts")).bursts.length);
    expect(stream.codec).toBe("dts-hd");
    expect(sha256(stream.bytes)).toBe(sha256(readFileSync(clip("dts").reference)));
  });

  test("TrueHD in MAT frames yields the source access units up to the unflushed last frame", () => {
    const { kinds, stream } = summarize(spdifOf("truehd"));
    const reference = readFileSync(clip("truehd").reference);
    expect(kinds).toEqual(["22/0"]);
    expect(stream).toMatchObject({ codec: "truehd", partialTailBytes: 0 });
    expectShortByAtMostOneMatFrame(stream.bytes, reference);
  });
});

describe("T0: captures the harness must reject", () => {
  test("a plain PCM sine WAV holds no bursts, while the AC-3 capture beside it does", () => {
    const pcm = readPcm16(readFileSync(synthesizePcmWav(dir)));
    expect(pcm).toMatchObject({ kind: "wav", channels: 2, sampleRate: 48000 });
    expect(scanBursts(pcm.data)).toEqual([]);
    expect(() => elementaryStream(scanBursts(pcm.data))).toThrow(
      new Iec61937Error("no audio-carrying bursts")
    );
    expect(elementaryStream(scanBursts(spdifOf("ac3"))).codec).toBe("ac3");
  });

  test("a MAT frame whose middle code is damaged fails at the fixed offset", () => {
    const pcm = Uint8Array.from(spdifOf("truehd"));
    const firstPayload = 8;
    pcm[firstPayload + 30708] = (pcm[firstPayload + 30708] ?? 0) ^ 0xff;
    expect(() => elementaryStream(scanBursts(pcm))).toThrow(
      new Iec61937Error("MAT burst at byte 0: middle code missing at frame offset 30708")
    );
  });
});
