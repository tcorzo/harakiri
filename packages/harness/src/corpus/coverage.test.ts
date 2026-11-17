import { expect, test } from "vitest";
import { CATALOG, type VideoRangeType } from "./catalog";

// What the contract and live tiers prove is only as wide as the corpus: these are the cases the
// census found in real libraries (docs/research/07-media-census.md) that the corpus can build.

test("the corpus carries every passthrough codec as Jellyfin reports it", () => {
  const passthrough = [
    "ac3",
    "eac3",
    "eac3 Dolby Digital Plus + Dolby Atmos",
    "truehd",
    "truehd Dolby TrueHD + Dolby Atmos",
    "dts DTS",
    "dts DTS-HD MA",
    "dts DTS-HD MA + DTS:X",
  ];
  const covered = new Set(
    CATALOG.flatMap((e) => e.expect.audio.map((a) => [a.codec, a.profile].join(" ").trim())),
  );
  expect(passthrough.filter((codec) => !covered.has(codec))).toEqual([]);
});

test("the corpus carries every HDR signalling case it can build", () => {
  const ranges: VideoRangeType[] = [
    "HDR10",
    "HLG",
    "HDR10Plus",
    "DOVI",
    "DOVIWithHDR10",
    "DOVIWithHLG",
    "DOVIWithHDR10Plus",
    "DOVIWithEL",
  ];
  const covered = new Set(CATALOG.map((e) => e.expect.video.range));
  expect(ranges.filter((range) => !covered.has(range))).toEqual([]);
});
