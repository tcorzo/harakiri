/**
 * A minimal, deterministic PGS (.sup) writer: one bitmap caption per cue.
 *
 * FFmpeg has no PGS encoder (only dvdsub), so the HDMV presentation graphic stream is written by
 * hand. Each cue is one display set (PCS, WDS, PDS, ODS, END) followed by a clearing set
 * (PCS, WDS, END). Timestamps are 90 kHz and dts equals pts.
 */

const PCS = 0x16;
const WDS = 0x17;
const PDS = 0x14;
const ODS = 0x15;
const END = 0x80;

export interface Cue {
  readonly start: number;
  readonly end: number;
}

class Bytes {
  readonly #parts: number[] = [];
  u8(...values: number[]): this {
    for (const v of values) {
      this.#parts.push(v & 0xff);
    }

    return this;
  }
  u16(...values: number[]): this {
    for (const v of values) {
      this.u8(v >> 8, v);
    }

    return this;
  }
  u24(v: number): this {
    return this.u8(v >> 16, v >> 8, v);
  }
  u32(v: number): this {
    return this.u8(v >>> 24, v >>> 16, v >>> 8, v);
  }
  bytes(data: Uint8Array): this {
    for (const v of data) {
      this.#parts.push(v);
    }

    return this;
  }
  get length(): number {
    return this.#parts.length;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.#parts);
  }
}

function segment(kind: number, pts: number, body: Uint8Array): Uint8Array {
  return new Bytes()
    .u8(0x50, 0x47) // "PG"
    .u32(pts)
    .u32(pts)
    .u8(kind)
    .u16(body.length)
    .bytes(body)
    .done();
}

/** One RLE-coded bitmap line, terminated by the end-of-line marker. */
export function rleLine(pixels: readonly number[]): Uint8Array {
  const out = new Bytes();
  let i = 0;

  while (i < pixels.length) {
    const c = pixels[i]!;
    let n = 1;

    while (i + n < pixels.length && pixels[i + n] === c && n < 16383) {
      n++;
    }

    if (c !== 0 && n <= 2) {
      for (let k = 0; k < n; k++) out.u8(c);
    } else if (c === 0) {
      if (n < 64) {
        out.u8(0, n);
      } else {
        out.u8(0, 0x40 | (n >> 8), n & 0xff);
      }
    } else if (n < 64) {
      out.u8(0, 0x80 | n, c);
    } else {
      out.u8(0, 0xc0 | (n >> 8), n & 0xff, c);
    }
    i += n;
  }

  return out.u8(0, 0).done();
}

/** A white bar with a 2-px black border and a checker band: easy to see once rendered. */
function bitmap(w: number, h: number): Uint8Array {
  const out = new Bytes();

  for (let y = 0; y < h; y++) {
    const row: number[] = [];

    for (let x = 0; x < w; x++) {
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) {
        row.push(2);
      } else if (Math.floor(h / 3) <= y && y < Math.floor((2 * h) / 3)) {
        row.push((Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 1 : 2);
      } else {
        row.push(1);
      }
    }

    out.bytes(rleLine(row));
  }

  return out.done();
}

function displaySet(width: number, height: number, comp: number, start: number, end: number) {
  const ow = Math.floor(width / 2);
  const oh = Math.floor(height / 8);
  const ox = Math.floor((width - ow) / 2);
  const oy = height - oh - Math.floor(height / 12);
  const rle = bitmap(ow, oh);
  const window = new Bytes().u8(1, 0).u16(ox, oy, ow, oh).done();

  const show = new Bytes()
    .u16(width, height)
    .u8(0x10)
    .u16(comp)
    .u8(0x80, 0, 0, 1) // epoch start, palette 0, one object
    .u16(0)
    .u8(0, 0)
    .u16(ox, oy)
    .done();

  // palette entries: id, Y, Cr, Cb, alpha (BT.709 limited range)
  const palette = new Bytes().u8(0, 0).u8(1, 235, 128, 128, 255).u8(2, 16, 128, 128, 255).done();

  const object = new Bytes()
    .u16(0)
    .u8(0, 0xc0) // version 0, first and last fragment
    .u24(rle.length + 4)
    .u16(ow, oh)
    .bytes(rle)
    .done();

  const clear = new Bytes()
    .u16(width, height)
    .u8(0x10)
    .u16(comp + 1)
    .u8(0x00, 0, 0, 0)
    .done();

  return [
    segment(PCS, start, show),
    segment(WDS, start, window),
    segment(PDS, start, palette),
    segment(ODS, start, object),
    segment(END, start, new Uint8Array()),
    segment(PCS, end, clear),
    segment(WDS, end, window),
    segment(END, end, new Uint8Array()),
  ];
}

/** A whole .sup stream for `cues` (seconds) on a `width`×`height` canvas. */
export function writePgs(width: number, height: number, cues: readonly Cue[]): Uint8Array {
  const out = new Bytes();
  cues.forEach((cue, n) => {
    const ticks = (s: number) => Math.round(s * 90_000);

    for (const seg of displaySet(width, height, n * 2, ticks(cue.start), ticks(cue.end))) {
      out.bytes(seg);
    }
  });

  return out.done();
}
