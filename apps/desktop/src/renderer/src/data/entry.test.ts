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
      { text: "4K HDR10" },
      { text: "TrueHD Atmos 7.1" },
    ]);
    expect(programmeNotes(item({ Codec: "flac", Channels: 2 }, "DOVIWithHDR10"))).toStrictEqual([
      { text: "1988" },
      { text: "125 min" },
      { text: "4K Dolby Vision", state: "mapped" },
      { text: "FLAC 2.0", state: "decoded" },
    ]);
  });

  it("a server type the programme does not know is not taken for a film", () => {
    expect([kindOf("Movie"), kindOf("Episode"), kindOf("BoxSet"), kindOf(undefined)]).toStrictEqual(
      ["Movie", "Episode", "Other", "Other"]
    );
  });
});
