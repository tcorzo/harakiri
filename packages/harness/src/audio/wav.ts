export type Pcm16 =
  | {
      readonly kind: "wav";
      readonly channels: number;
      readonly sampleRate: number;
      readonly data: Uint8Array;
    }
  | { readonly kind: "raw"; readonly data: Uint8Array };

export class WavError extends Error {
  override readonly name = "WavError";
}

const WAVE_FORMAT_PCM = 0x00_01;
const WAVE_FORMAT_EXTENSIBLE = 0xff_fe;

function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + 4));
}

/**
 * Returns the 16-bit little-endian sample bytes of a capture. A RIFF/WAVE file is
 * walked chunk by chunk because ao_pcm writes WAVE_FORMAT_EXTENSIBLE (68-byte
 * header) and other writers add LIST chunks, so the data offset is not fixed.
 * Anything that does not start with RIFF is taken as headerless s16le.
 */
export function readPcm16(file: Uint8Array): Pcm16 {
  if (file.length < 12 || fourcc(file, 0) !== "RIFF") {
    return { kind: "raw", data: file };
  }

  if (fourcc(file, 8) !== "WAVE") {
    throw new WavError(`RIFF form type is ${fourcc(file, 8)}, not WAVE`);
  }

  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let format: { channels: number; sampleRate: number } | undefined;
  let at = 12;

  while (at + 8 <= file.length) {
    const id = fourcc(file, at);
    const declared = view.getUint32(at + 4, true);
    const body = at + 8;
    // ao_pcm leaves a placeholder size when the file was not finalized, so clamp to what exists.
    const size = Math.min(declared, file.length - body);

    if (id === "fmt ") {
      const tag = view.getUint16(body, true);
      const bits = view.getUint16(body + 14, true);

      if (tag !== WAVE_FORMAT_PCM && tag !== WAVE_FORMAT_EXTENSIBLE) {
        throw new WavError(`fmt tag 0x${tag.toString(16)} is not integer PCM`);
      }

      if (bits !== 16) {
        throw new WavError(`fmt has ${bits} bits per sample, IEC 61937 needs 16`);
      }
      format = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
      };
    } else if (id === "data") {
      if (format === undefined) {
        throw new WavError("data chunk precedes fmt chunk");
      }

      return { kind: "wav", ...format, data: file.subarray(body, body + size) };
    }

    at = body + size + (size & 1);
  }

  throw new WavError("no data chunk");
}
