/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { zMediaSourceInfo } from "../generated/zod.gen";
import { scrubPlaybackInfo, scrubSource, scrubText } from "./scrub";

const RecordedSource = zMediaSourceInfo.pick({
  Id: true,
  Container: true,
  DefaultAudioStreamIndex: true,
  MediaStreams: true,
});

const REAL_ID = "0123456789abcdef0123456789abcdef";

describe(scrubSource, () => {
  it("replaces paths, names, ids, ETags and attachment names, and keeps stream facts", () => {
    const scrubbed = scrubSource(
      {
        Id: REAL_ID,
        Path: "/media/movies/Some Film (1999)/Some Film 1999 2160p GROUP.mkv",
        Name: "Some Film 1999 2160p GROUP",
        ETag: "fedcba9876543210fedcba9876543210",
        MediaStreams: [
          {
            Index: 0,
            Codec: "subrip",
            Path: "/media/movies/Some Film (1999)/Some Film 1999 2160p GROUP.en.hi.srt",
            DeliveryUrl:
              "/Videos/01234567-89ab-cdef-0123-456789abcdef/0123456789ABCDEF0123456789ABCDEF",
          },
          { Index: 1, Codec: "srt", Path: "/elsewhere/subs.srt" },
          { Index: 2, Codec: "truehd", Channels: 8, Title: "Commentary by A. Director - English" },
        ],
        MediaAttachments: [{ FileName: "Some Font.ttf" }],
      },
      "dv5-eac3"
    );

    expect(scrubbed).toStrictEqual({
      Id: "3653ee5a956c9868ec7fdf0caff8a2cb",
      Path: "/media/movies/fixture-dv5-eac3.mkv",
      Name: "Fixture dv5-eac3",
      ETag: "376993b461994d0e9970e322607cdb65",
      MediaStreams: [
        {
          Index: 0,
          Codec: "subrip",
          Path: "/media/movies/fixture-dv5-eac3.en.hi.srt",
          DeliveryUrl:
            "/Videos/3653ee5a-956c-9868-ec7f-df0caff8a2cb/3653ee5a956c9868ec7fdf0caff8a2cb",
        },
        { Index: 1, Codec: "srt", Path: "/media/movies/fixture-dv5-eac3.1.srt" },
        { Index: 2, Codec: "truehd", Channels: 8, Title: "Commentary - English" },
      ],
      MediaAttachments: [{ FileName: "attachment-0.ttf" }],
    });
  });

  it("a play session id is replaced wherever it appears", () => {
    const scrubbed = scrubPlaybackInfo(
      {
        PlaySessionId: "abc123",
        MediaSources: [
          { Id: REAL_ID, TranscodingUrl: `/videos/${REAL_ID}/master.m3u8?PlaySessionId=abc123` },
        ],
      },
      "transcode-bitrate"
    );

    expect(scrubbed).toStrictEqual({
      PlaySessionId: "e885ab483b5abe4a5dc3457e102ff5c1",
      MediaSources: [
        {
          Id: "333d2fed9dc9bd770dfa6843547d111a",
          TranscodingUrl:
            "/videos/333d2fed9dc9bd770dfa6843547d111a/master.m3u8?PlaySessionId=e885ab483b5abe4a5dc3457e102ff5c1",
        },
      ],
    });
  });
});

describe("scrub helpers", () => {
  it("scrubText drops credits, release tags, encoder credits and dubbing studios", () => {
    expect(
      [
        "Commentary with the director and a producer - English - Default",
        "1080p AV1 [GROUP] - SDR",
        "[EN] Opus 160kbit/s Stereo",
        "Encoded by someone - 4K - HEVC - HDR",
        "Some Film (1999) - 1080p - AV1 - SDR",
        "MVO (Some Studio) - Russian - Dolby Digital - Stereo",
        "Forced - English - PGSSUB",
      ].map(scrubText)
    ).toStrictEqual([
      "Commentary - English - Default",
      "1080p AV1 - SDR",
      "[EN] Opus 160kbit/s Stereo",
      "Main video - 4K - HEVC - HDR",
      "Main video - 1080p - AV1 - SDR",
      "MVO - Russian - Dolby Digital - Stereo",
      "Forced - English - PGSSUB",
    ]);
  });

  it("every recorded MediaSource fixture is already scrubbed", () => {
    const names = readdirSync(new URL(".", import.meta.url)).filter((file) =>
      file.endsWith(".json")
    );

    expect(names).toHaveLength(18);

    for (const file of names) {
      const json: unknown = JSON.parse(readFileSync(new URL(file, import.meta.url), "utf-8"));
      const source = RecordedSource.parse(json);

      expect({ file, json }).toStrictEqual({ file, json: scrubSource(source, file.slice(0, -5)) });
    }
  });
});
