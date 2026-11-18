import { match } from "ts-pattern";

type LengthUnit = "bits" | "bytes";
type StreamCodec = "ac3" | "eac3" | "dts" | "dts-hd" | "truehd";

/**
 * IEC 61937-1 data types (Pc bits 0-4) as FFmpeg's spdif.h names them. `pd` is the unit
 * of the Pd length word: bytes for E-AC-3, DTS type IV and MAT, bits for the rest.
 * `stream` names the elementary stream the payload carries, or null for filler bursts
 * and codecs this harness does not unwrap.
 */
const DATA_TYPES = [
  { code: 0x00, name: "null", pd: "bits", stream: null },
  { code: 0x01, name: "ac3", pd: "bits", stream: "ac3" },
  { code: 0x03, name: "pause", pd: "bits", stream: null },
  { code: 0x04, name: "mpeg1-layer1", pd: "bits", stream: null },
  { code: 0x05, name: "mpeg1-layer23", pd: "bits", stream: null },
  { code: 0x06, name: "mpeg2-ext", pd: "bits", stream: null },
  { code: 0x07, name: "mpeg2-aac", pd: "bits", stream: null },
  { code: 0x08, name: "mpeg2-layer1-lsf", pd: "bits", stream: null },
  { code: 0x09, name: "mpeg2-layer2-lsf", pd: "bits", stream: null },
  { code: 0x0a, name: "mpeg2-layer3-lsf", pd: "bits", stream: null },
  { code: 0x0b, name: "dts-type1", pd: "bits", stream: "dts" },
  { code: 0x0c, name: "dts-type2", pd: "bits", stream: "dts" },
  { code: 0x0d, name: "dts-type3", pd: "bits", stream: "dts" },
  { code: 0x0e, name: "atrac", pd: "bits", stream: null },
  { code: 0x0f, name: "atrac3", pd: "bits", stream: null },
  { code: 0x10, name: "atrac3plus", pd: "bits", stream: null },
  { code: 0x11, name: "dts-type4", pd: "bytes", stream: "dts-hd" },
  { code: 0x12, name: "wma-pro", pd: "bits", stream: null },
  { code: 0x13, name: "mpeg2-aac-lsf", pd: "bits", stream: null },
  { code: 0x15, name: "eac3", pd: "bytes", stream: "eac3" },
  { code: 0x16, name: "mat", pd: "bytes", stream: "truehd" },
] as const satisfies readonly {
  code: number;
  name: string;
  pd: LengthUnit;
  stream: StreamCodec | null;
}[];

type DataTypeEntry = (typeof DATA_TYPES)[number];
export type DataTypeName = DataTypeEntry["name"];

const DATA_TYPE_BY_CODE: ReadonlyMap<number, DataTypeEntry> = new Map(
  DATA_TYPES.map((t) => [t.code, t])
);

export interface Burst {
  /** Pc bits 0-4. */
  readonly dataType: number;
  readonly name: DataTypeName;
  /** Pc bits 8-12: AC-3 bitstream mode, DTS type IV repetition-period subtype. */
  readonly subtype: number;
  /** Byte offset of Pa in the PCM stream. */
  readonly offset: number;
  /** Payload restored to big-endian byte order, exactly Pd long. */
  readonly payload: Uint8Array;
}

export type ElementaryStream =
  | {
      readonly codec: "ac3" | "eac3" | "dts" | "dts-hd";
      readonly bytes: Uint8Array;
      readonly bursts: number;
    }
  | {
      readonly codec: "truehd";
      readonly bytes: Uint8Array;
      readonly bursts: number;
      /** Bytes of a final access unit that the last MAT frame cut short. */
      readonly partialTailBytes: number;
    };

export class Iec61937Error extends Error {
  override readonly name = "Iec61937Error";
}

const PA = 0xf872;
const PB = 0x4e1f;
const BURST_HEADER_SIZE = 8;

/**
 * Finds every data burst in a 16-bit little-endian IEC 61937 stream (as FFmpeg's spdif
 * muxer and mpv's ao_pcm write it). The stream is one flat word sequence regardless of
 * channel count: an 8-channel HBR capture interleaves nothing.
 *
 * Bursts without a preamble (DTS frames that exactly fill the repetition period, as on
 * DTS-in-WAV discs) carry no Pa/Pb and are invisible here by construction.
 */
export function scanBursts(pcm: Uint8Array): Burst[] {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const bursts: Burst[] = [];
  let at = 0;
  while (at + BURST_HEADER_SIZE <= pcm.length) {
    if (view.getUint16(at, true) !== PA || view.getUint16(at + 2, true) !== PB) {
      at += 2;
      continue;
    }
    const pc = view.getUint16(at + 4, true);
    const pd = view.getUint16(at + 6, true);
    const dataType = pc & 0x1f;
    const entry = DATA_TYPE_BY_CODE.get(dataType);
    if (entry === undefined) {
      throw new Iec61937Error(`reserved data type 0x${dataType.toString(16)} at byte ${at}`);
    }
    const length = entry.pd === "bytes" ? pd : Math.ceil(pd / 8);
    const start = at + BURST_HEADER_SIZE;
    const wordAlignedEnd = start + length + (length & 1);
    if (wordAlignedEnd > pcm.length) {
      throw new Iec61937Error(
        `${entry.name} burst at byte ${at} needs ${length} bytes, stream ends first`
      );
    }
    bursts.push({
      dataType,
      name: entry.name,
      subtype: (pc >> 8) & 0x1f,
      offset: at,
      payload: swapWords(pcm.subarray(start, wordAlignedEnd)).subarray(0, length),
    });
    at = wordAlignedEnd;
  }
  return bursts;
}

function swapWords(le: Uint8Array): Uint8Array {
  const be = new Uint8Array(le.length);
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1] ?? 0;
    be[i + 1] = le[i] ?? 0;
  }
  return be;
}

/**
 * Reassembles the elementary stream the bursts carry, undoing each codec's IEC 61937
 * wrapping. Filler bursts (null, pause) are skipped. Mixing codecs is an error: a
 * passthrough capture of one track carries exactly one.
 */
export function elementaryStream(bursts: readonly Burst[]): ElementaryStream {
  const carried = bursts.flatMap((burst) => {
    const stream = DATA_TYPE_BY_CODE.get(burst.dataType)?.stream ?? null;
    return stream === null ? [] : [{ stream, burst }];
  });
  const first = carried[0];
  if (first === undefined) throw new Iec61937Error("no audio-carrying bursts");
  const other = carried.find((c) => c.stream !== first.stream);
  if (other !== undefined) {
    throw new Iec61937Error(
      `mixed codecs: ${first.stream} and ${other.stream} at byte ${other.burst.offset}`
    );
  }
  const payloads = carried.map((c) => c.burst);
  return match(first.stream)
    .with("ac3", "eac3", "dts", (codec) => ({
      codec,
      bytes: concat(payloads.map((b) => b.payload)),
      bursts: payloads.length,
    }))
    .with("dts-hd", (codec) => ({
      codec,
      bytes: concat(payloads.map(unwrapDtsTypeIV)),
      bursts: payloads.length,
    }))
    .with("truehd", (codec) => ({
      codec,
      ...walkTrueHdAccessUnits(concat(payloads.map(unwrapMatFrame))),
      bursts: payloads.length,
    }))
    .exhaustive();
}

const DTSHD_START_CODE = Uint8Array.of(0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xfe, 0xfe);

/**
 * DTS type IV payload: a 10-byte start code, a big-endian frame length, the DTS-HD
 * frame, then padding. Pd is rounded up for receivers, so the inner length is the
 * only exact size.
 */
function unwrapDtsTypeIV(burst: Burst): Uint8Array {
  const { payload, offset } = burst;
  if (!startsWith(payload, DTSHD_START_CODE, 0)) {
    throw new Iec61937Error(`DTS type IV burst at byte ${offset} lacks the DTS-HD start code`);
  }
  const frameLength = ((payload[10] ?? 0) << 8) | (payload[11] ?? 0);
  const frameStart = DTSHD_START_CODE.length + 2;
  if (frameStart + frameLength > payload.length) {
    throw new Iec61937Error(
      `DTS type IV burst at byte ${offset} declares ${frameLength} bytes, holds fewer`
    );
  }
  return payload.subarray(frameStart, frameStart + frameLength);
}

const MAT_FRAME_SIZE = 61424;
const MAT_CODES = [
  {
    label: "start",
    at: 0,
    code: Uint8Array.of(
      0x07,
      0x9e,
      0x00,
      0x03,
      0x84,
      0x01,
      0x01,
      0x01,
      0x80,
      0x00,
      0x56,
      0xa5,
      0x3b,
      0xf4,
      0x81,
      0x83,
      0x49,
      0x80,
      0x77,
      0xe0
    ),
  },
  {
    label: "middle",
    at: 30708,
    code: Uint8Array.of(0xc3, 0xc1, 0x42, 0x49, 0x3b, 0xfa, 0x82, 0x83, 0x49, 0x80, 0x77, 0xe0),
  },
  {
    label: "end",
    at: 61408,
    code: Uint8Array.of(
      0xc3,
      0xc2,
      0xc0,
      0xc4,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x97,
      0x11
    ),
  },
] as const;

/**
 * A MAT frame is TrueHD data with three marker codes at fixed positions (FFmpeg
 * spdifenc.c `mat_codes`); data that reaches a marker continues after it, so cutting
 * the markers out at their offsets leaves the data contiguous. Every marker is checked
 * byte for byte rather than searched for, so a shifted or missing code fails loudly.
 */
function unwrapMatFrame(burst: Burst): Uint8Array {
  const { payload, offset } = burst;
  if (payload.length !== MAT_FRAME_SIZE) {
    throw new Iec61937Error(
      `MAT burst at byte ${offset} is ${payload.length} bytes, not ${MAT_FRAME_SIZE}`
    );
  }
  const segments: Uint8Array[] = [];
  let cursor = 0;
  for (const { label, at, code } of MAT_CODES) {
    if (!startsWith(payload, code, at)) {
      throw new Iec61937Error(
        `MAT burst at byte ${offset}: ${label} code missing at frame offset ${at}`
      );
    }
    segments.push(payload.subarray(cursor, at));
    cursor = at + code.length;
  }
  return concat(segments);
}

/**
 * Splits deframed MAT data into TrueHD access units. Each unit starts with a word whose
 * low 12 bits are its length in 16-bit words, which is never zero, so a zero word can
 * only be spdifenc's inter-unit padding.
 */
function walkTrueHdAccessUnits(data: Uint8Array): { bytes: Uint8Array; partialTailBytes: number } {
  const units: Uint8Array[] = [];
  let at = 0;
  while (at + 2 <= data.length) {
    const word = ((data[at] ?? 0) << 8) | (data[at + 1] ?? 0);
    if (word === 0) {
      at += 2;
      continue;
    }
    const length = (word & 0x0fff) * 2;
    if (at + length > data.length)
      return { bytes: concat(units), partialTailBytes: data.length - at };
    units.push(data.subarray(at, at + length));
    at += length;
  }
  return { bytes: concat(units), partialTailBytes: 0 };
}

function startsWith(haystack: Uint8Array, needle: Uint8Array, at: number): boolean {
  return needle.every((byte, i) => haystack[at + i] === byte);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
