import type { BaseItemDto, VideoRangeType } from "@harakiri/jellyfin/generated";
import { describe, expect, it } from "vitest";

import { kindOf, programmeNotes, toEntry } from "./entry";

const item = (
  audio: { Codec: string; Profile?: string; Channels: number },
  range: VideoRangeType
): ReturnType<typeof toEntry> => {
  const raw: BaseItemDto = {
    Id: "0123456789abcdef0123456789abcdef",
    Type: "Movie",
    Name: "Synthetic",
    ProductionYear: 1988,
    RunTimeTicks: 74_856_200_000,
    MediaSources: [
      {
        MediaStreams: [
          { Type: "Video", Width: 3840, Height: 2160, VideoRange: "HDR", VideoRangeType: range },
          { Type: "Audio", Index: 1, ...audio },
        ],
      },
    ],
  };

  return toEntry(raw);
};

describe("entry", () => {
  it("native facts are stated bare; only mapped and decoded carry a state", () => {
    expect(
      programmeNotes(item({ Codec: "truehd", Profile: "TrueHD + Atmos", Channels: 8 }, "HDR10"))
    ).toStrictEqual([
      { text: "1988" },
      { text: "125 min" },
      { text: "4K HDR10", parts: [{ text: "4K" }, { logo: "hdr10" }] },
      {
        text: "TrueHD Atmos 7.1",
        parts: [{ logo: "dolby-truehd" }, { logo: "dolby-atmos" }, { text: "7.1" }],
      },
    ]);
    expect(programmeNotes(item({ Codec: "flac", Channels: 2 }, "DOVIWithHDR10"))).toStrictEqual([
      { text: "1988" },
      { text: "125 min" },
      {
        text: "4K Dolby Vision",
        state: "mapped",
        parts: [{ text: "4K" }, { logo: "dolby-vision" }],
      },
      { text: "FLAC 2.0", state: "decoded", parts: [{ text: "FLAC 2.0" }] },
    ]);
  });

  it("a format with a logo is drawn as it; DTS-HD names its tier in words beside the DTS logo", () => {
    const [picture, sound] = programmeNotes(
      item({ Codec: "dts", Profile: "DTS-HD MA", Channels: 6 }, "HDR10Plus")
    ).slice(2);

    expect(picture).toStrictEqual({
      text: "4K HDR10+",
      parts: [{ text: "4K" }, { logo: "hdr10-plus" }],
    });
    expect(sound).toStrictEqual({
      text: "DTS-HD MA 5.1",
      parts: [{ logo: "dts" }, { text: "HD MA 5.1" }],
    });
  });

  it("a server type the programme does not know is not taken for a film", () => {
    expect([kindOf("Movie"), kindOf("Episode"), kindOf("BoxSet"), kindOf(undefined)]).toStrictEqual(
      ["Movie", "Episode", "Other", "Other"]
    );
  });
});
