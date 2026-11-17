import { expect } from "vitest";

import { sha256 } from "./clips";

// IEC 61937-9: one MAT frame spans 61440 bytes at TrueHD's 192 kHz, 8-channel carrier.
const MAT_FRAME_BYTES = 61_440;

/**
 * The spdif muxer holds back the access units of a MAT frame it has not filled, so the
 * extracted stream is a strict prefix of the source, missing less than one MAT frame.
 */
export const expectShortByAtMostOneMatFrame = (extracted: Uint8Array, source: Uint8Array): void => {
  const missing = source.length - extracted.length;
  expect(missing).toBeGreaterThan(0);
  expect(missing).toBeLessThan(MAT_FRAME_BYTES);
  expect(sha256(extracted)).toBe(sha256(source.subarray(0, extracted.length)));
};
