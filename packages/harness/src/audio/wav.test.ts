import { describe, expect, it } from "vitest";

import { readPcm16, WavError } from "./wav";

const le16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];

const le32 = (n: number): number[] => [
  n & 0xff,
  (n >> 8) & 0xff,
  (n >> 16) & 0xff,
  (n >>> 24) & 0xff,
];

const ascii = (s: string): number[] => Array.from(s, (c) => c.codePointAt(0) ?? 0);

const chunk = (id: string, body: number[]): number[] => [
  ...ascii(id),
  ...le32(body.length),
  ...body,
  ...(body.length & 1 ? [0] : []),
];

const fmt = (tag: number, channels: number, rate: number, bits: number): number[] =>
  chunk("fmt ", [
    ...le16(tag),
    ...le16(channels),
    ...le32(rate),
    ...le32(0),
    ...le16(0),
    ...le16(bits),
  ]);

const riff = (...chunks: number[][]): Uint8Array => {
  const body = [...ascii("WAVE"), ...chunks.flat()];

  return Uint8Array.from([...ascii("RIFF"), ...le32(body.length), ...body]);
};

describe(readPcm16, () => {
  it("walks past an odd-sized LIST chunk to an extensible fmt and the data chunk", () => {
    const file = riff(
      chunk("LIST", [1, 2, 3]),
      fmt(0xff_fe, 8, 192_000, 16),
      chunk("data", [0x72, 0xf8, 0x1f, 0x4e])
    );

    expect(readPcm16(file)).toStrictEqual({
      kind: "wav",
      channels: 8,
      sampleRate: 192_000,
      data: Uint8Array.of(0x72, 0xf8, 0x1f, 0x4e),
    });
  });

  it("clamps a placeholder data size to the bytes present", () => {
    const head = riff(fmt(1, 2, 48_000, 16));
    const file = Uint8Array.from([...head, ...ascii("data"), ...le32(0x7f_ff_f0_00), 9, 8, 7, 6]);
    expect(readPcm16(file)).toStrictEqual({
      kind: "wav",
      channels: 2,
      sampleRate: 48_000,
      data: Uint8Array.of(9, 8, 7, 6),
    });
  });

  it("passes headerless bytes through as raw s16le", () => {
    expect(readPcm16(Uint8Array.of(0x72, 0xf8, 0x1f, 0x4e))).toStrictEqual({
      kind: "raw",
      data: Uint8Array.of(0x72, 0xf8, 0x1f, 0x4e),
    });
  });

  it("rejects 24-bit PCM, which cannot carry IEC 61937", () => {
    const file = riff(fmt(1, 2, 48_000, 24), chunk("data", [0, 0, 0]));
    expect(() => readPcm16(file)).toThrow(
      new WavError("fmt has 24 bits per sample, IEC 61937 needs 16")
    );
  });
});
