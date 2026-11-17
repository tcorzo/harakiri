import { describe, expect, it } from "vitest";

import { elementaryStream, Iec61937Error, scanBursts } from "./iec61937";

/** Writes one burst the way spdifenc does: LE header words, payload byte-swapped into LE words. */
const burst = (
  pc: number,
  pd: number,
  payloadBigEndian: readonly number[],
  padTo = 0
): number[] => {
  const padded = payloadBigEndian.length & 1 ? [...payloadBigEndian, 0] : [...payloadBigEndian];

  const swapped = padded.flatMap((_, i) =>
    i % 2 === 0 ? [padded[i + 1] ?? 0, padded[i] ?? 0] : []
  );

  const out = [0x72, 0xf8, 0x1f, 0x4e, pc & 0xff, pc >> 8, pd & 0xff, pd >> 8, ...swapped];

  return [...out, ...Array.from({ length: Math.max(0, padTo - out.length) }, () => 0)];
};

const DTSHD_HEADER = [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xfe, 0xfe];

describe(scanBursts, () => {
  it("finds an AC-3 burst after leading silence and restores big-endian payload", () => {
    const stream = Uint8Array.from([
      0,
      0,
      0,
      0,
      ...burst(0x00_01, 32, [0x0b, 0x77, 0x12, 0x34], 24),
    ]);

    expect(scanBursts(stream)).toStrictEqual([
      {
        dataType: 1,
        name: "ac3",
        subtype: 0,
        offset: 4,
        payload: Uint8Array.of(0x0b, 0x77, 0x12, 0x34),
      },
    ]);
  });

  it("reads Pd in bytes for E-AC-3 and keeps an odd final byte from the word's high half", () => {
    const stream = Uint8Array.from(burst(0x00_15, 3, [0x0b, 0x77, 0x99]));
    expect(scanBursts(stream).map((b) => [b.name, [...b.payload]])).toStrictEqual([
      ["eac3", [0x0b, 0x77, 0x99]],
    ]);
  });

  it("ignores a sync word at an odd byte offset", () => {
    const stream = Uint8Array.from([0, 0x72, 0xf8, 0x1f, 0x4e, 0x01, 0x00, 0x08, 0x00, 0, 0, 0]);
    expect(scanBursts(stream)).toStrictEqual([]);
  });

  it("rejects a reserved data type", () => {
    expect(() => scanBursts(Uint8Array.from(burst(0x00_14, 0, [])))).toThrow(
      new Iec61937Error("reserved data type 0x14 at byte 0")
    );
  });

  it("rejects a burst cut off by the end of the stream", () => {
    const cut = burst(0x00_15, 6, [1, 2, 3, 4, 5, 6]).slice(0, 12);
    expect(() => scanBursts(Uint8Array.from(cut))).toThrow(
      new Iec61937Error("eac3 burst at byte 0 needs 6 bytes, stream ends first")
    );
  });
});

describe(elementaryStream, () => {
  it("unwraps DTS type IV frames by their inner length and reports the period subtype", () => {
    const stream = Uint8Array.from([
      ...burst(0x04_11, 16, [...DTSHD_HEADER, 0x00, 0x02, 0xaa, 0xbb, 0x00, 0x00]),
      ...burst(0x04_11, 16, [...DTSHD_HEADER, 0x00, 0x01, 0xcc, 0x00, 0x00, 0x00]),
    ]);

    const bursts = scanBursts(stream);
    expect(bursts.map((b) => [b.dataType, b.subtype])).toStrictEqual([
      [17, 4],
      [17, 4],
    ]);
    expect(elementaryStream(bursts)).toStrictEqual({
      codec: "dts-hd",
      bytes: Uint8Array.of(0xaa, 0xbb, 0xcc),
      bursts: 2,
    });
  });

  it("skips pause bursts between audio bursts", () => {
    const stream = Uint8Array.from([
      ...burst(0x00_01, 16, [0x0b, 0x77]),
      ...burst(0x00_03, 32, [0, 0x20, 0, 0]),
      ...burst(0x00_01, 16, [0x0b, 0x78]),
    ]);

    expect(elementaryStream(scanBursts(stream))).toStrictEqual({
      codec: "ac3",
      bytes: Uint8Array.of(0x0b, 0x77, 0x0b, 0x78),
      bursts: 2,
    });
  });

  it("rejects a capture that switches codec", () => {
    const stream = Uint8Array.from([
      ...burst(0x00_01, 16, [0x0b, 0x77]),
      ...burst(0x00_15, 2, [0x0b, 0x77]),
    ]);

    expect(() => elementaryStream(scanBursts(stream))).toThrow(
      new Iec61937Error("mixed codecs: ac3 and eac3 at byte 10")
    );
  });

  it("joins TrueHD access units split by the MAT middle code and by a frame boundary", () => {
    const MAT_START = [
      0x07, 0x9e, 0x00, 0x03, 0x84, 0x01, 0x01, 0x01, 0x80, 0x00, 0x56, 0xa5, 0x3b, 0xf4, 0x81,
      0x83, 0x49, 0x80, 0x77, 0xe0,
    ];

    const MAT_MIDDLE = [0xc3, 0xc1, 0x42, 0x49, 0x3b, 0xfa, 0x82, 0x83, 0x49, 0x80, 0x77, 0xe0];
    const MAT_END = [0xc3, 0xc2, 0xc0, 0xc4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x97, 0x11];

    // 4000-byte units (2000 words): 30688-byte half frames are not a multiple, so units straddle both markers.
    const unit = (n: number) => [
      0xf0 | (2000 >> 8),
      2000 & 0xff,
      ...Array.from({ length: 3998 }, () => n + 1),
    ];

    const data = Array.from({ length: 31 }, (_, n) => unit(n)).flat();

    const frame = (part: number[]) => [
      ...MAT_START,
      ...part.slice(0, 30_688),
      ...MAT_MIDDLE,
      ...part.slice(30_688, 61_376),
      ...MAT_END,
    ];

    const stream = Uint8Array.from([
      ...burst(0x00_16, 61_424, frame(data.slice(0, 61_376)), 61_440),
      ...burst(0x00_16, 61_424, frame(data.slice(61_376, 122_752)), 61_440),
    ]);

    const extracted = elementaryStream(scanBursts(stream));
    expect(extracted).toMatchObject({ codec: "truehd", bursts: 2, partialTailBytes: 2752 });
    expect(extracted.bytes).toStrictEqual(Uint8Array.from(data.slice(0, 120_000)));
  });

  it("rejects a DTS type IV burst without the DTS-HD start code", () => {
    const stream = Uint8Array.from(burst(0x04_11, 4, [0xde, 0xad, 0xbe, 0xef]));
    expect(() => elementaryStream(scanBursts(stream))).toThrow(
      new Iec61937Error("DTS type IV burst at byte 0 lacks the DTS-HD start code")
    );
  });
});
