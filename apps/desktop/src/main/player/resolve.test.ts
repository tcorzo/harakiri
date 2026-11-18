// @vitest-environment node
import { ServerUrl } from "@harakiri/jellyfin";
import { describe, expect, test } from "vitest";

import { playbackInfo } from "./fixtures/load";
import { programmeEntry, resolve, transcodeReasons } from "./resolve";

const server = ServerUrl.parse("http://jf.test");
const dvTruehd = playbackInfo("dv-hdr10-truehd-atmos");
const transcode = playbackInfo("transcode-bitrate");

describe("resolve", () => {
  test("a direct-play source gets the static URL and the chosen tracks as mpv ids", () => {
    const resolution = resolve(
      dvTruehd,
      { itemId: "fe56760a326f401c35863368589d15f1", audioStreamIndex: 3, subtitleStreamIndex: 1 },
      server
    );
    expect(resolution).toMatchObject({
      method: "DirectPlay",
      url: "http://jf.test/Videos/fe56760a326f401c35863368589d15f1/stream?static=true&MediaSourceId=fe56760a326f401c35863368589d15f1",
      playSessionId: dvTruehd.PlaySessionId,
      mediaSourceId: "fe56760a326f401c35863368589d15f1",
      transcodeReasons: [],
      audioStreamIndex: 3,
      subtitleStreamIndex: 1,
      aid: 1,
      sid: 6,
      durationTicks: 74_864_800_000,
    });
  });

  test("without choices it follows the server defaults, and -1 turns subtitles off", () => {
    const defaults = resolve(dvTruehd, { itemId: "fe56760a326f401c35863368589d15f1" }, server);
    expect([defaults.aid, defaults.sid, defaults.audioStreamIndex]).toEqual([3, 5, 5]);
    const off = resolve(
      dvTruehd,
      { itemId: "fe56760a326f401c35863368589d15f1", subtitleStreamIndex: -1 },
      server
    );
    expect(off.sid).toBe(false);
  });

  test("a TranscodingUrl is played as given and its reasons are stated in plain words", () => {
    const resolution = resolve(transcode, { itemId: "333d2fed9dc9bd770dfa6843547d111a" }, server);
    expect(resolution.method).toBe("Transcode");
    expect(
      resolution.url.startsWith(
        "http://jf.test/videos/333d2fed-9dc9-bd77-0dfa-6843547d111a/master.m3u8?"
      )
    ).toBe(true);
    expect(resolution.transcodeReasons).toEqual(["Bitrate over the limit"]);
    expect(resolution.unreadable).toBe(false);
    expect([resolution.audioStreamIndex, resolution.aid]).toEqual([4, 1]);
  });

  test("a source the server never probed is unreadable, not just transcoded", () => {
    const resolution = resolve(
      {
        PlaySessionId: "p",
        MediaSources: [
          {
            Id: "0123456789abcdef0123456789abcdef",
            MediaStreams: [],
            TranscodingUrl: "/videos/x/master.m3u8?TranscodeReasons=DirectPlayError",
          },
        ],
      },
      { itemId: "0123456789abcdef0123456789abcdef" },
      server
    );
    expect([resolution.unreadable, resolution.method]).toEqual([true, "Transcode"]);
  });

  test("a direct play without stream information is not called unreadable", () => {
    const resolution = resolve(
      {
        PlaySessionId: "p",
        MediaSources: [{ Id: "0123456789abcdef0123456789abcdef", MediaStreams: [] }],
      },
      { itemId: "0123456789abcdef0123456789abcdef" },
      server
    );
    expect([resolution.unreadable, resolution.method]).toEqual([false, "DirectPlay"]);
  });

  test("a server error code becomes a plain sentence", () => {
    expect(() =>
      resolve({ ErrorCode: "NoCompatibleStream", MediaSources: [] }, { itemId: "x" }, server)
    ).toThrow("The server found no playable stream");
  });
});

test("transcodeReasons maps every listed reason and keeps unknown ones verbatim", () => {
  expect(
    transcodeReasons(
      "/videos/x/master.m3u8?TranscodeReasons=VideoRangeTypeNotSupported,AudioChannelsNotSupported,NewReason"
    )
  ).toEqual(["HDR format not supported", "Too many audio channels", "NewReason"]);
});

describe("programmeEntry", () => {
  test("a film reads year, runtime and rating", () => {
    expect(
      programmeEntry({
        Type: "Movie",
        Name: "Fixture Film",
        ProductionYear: 2001,
        RunTimeTicks: 74_856_200_000,
        OfficialRating: "R",
      })
    ).toEqual({ title: "Fixture Film", programme: "2001 · 2 h 5 min · R" });
  });

  test("an episode is titled by its series", () => {
    expect(
      programmeEntry({
        Type: "Episode",
        Name: "The Second Evening",
        SeriesName: "Fixture Series: Night Shift",
        ParentIndexNumber: 2,
        IndexNumber: 1,
        RunTimeTicks: 17_080_000_000,
      })
    ).toEqual({
      title: "Fixture Series: Night Shift",
      programme: "S2 E1 · The Second Evening · 28 min",
    });
  });
});
