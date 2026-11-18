import { describe, expect, test } from "vitest";

import {
  ServerVersion,
  deviceProfile,
  playbackInfoRequest,
  profileAllowsAllRanges,
} from "./device-profile";
import type { DeviceProfile } from "./generated/types.gen";
import { MediaSourceId, UserId } from "./ids";

const v12 = ServerVersion.parse("12.4.0");
const v10 = ServerVersion.parse("10.11.3");

const TEXT = [
  "srt",
  "subrip",
  "ass",
  "ssa",
  "vtt",
  "webvtt",
  "mov_text",
  "ttml",
  "smi",
  "sami",
  "sub",
  "microdvd",
];

const IMAGE = ["pgssub", "pgs", "dvdsub", "vobsub", "dvbsub"];

const subtitleRows = (profile: DeviceProfile) =>
  (profile.SubtitleProfiles ?? [])
    .map((s) => [s.Format, s.Method, s.Container ?? ""].join("|"))
    .sort();

// jellyfin-desktop native/nativeshell.js with force_transcode_dovi, which defaults to true.
const jellyfinDesktopDefault: DeviceProfile = {
  ...deviceProfile(v12),
  CodecProfiles: [
    {
      Type: "Video",
      Conditions: [{ Condition: "NotEquals", Property: "VideoRangeType", Value: "DOVI" }],
    },
  ],
};

describe("deviceProfile", () => {
  test("declares no codec conditions and wildcard direct play", () => {
    const profile = deviceProfile(v12);
    expect(profile.CodecProfiles).toEqual([]);
    expect(profile.DirectPlayProfiles).toEqual([
      { Type: "Video" },
      { Type: "Audio" },
      { Type: "Photo" },
    ]);
  });

  test("caps bitrate at 1e9 instead of the server's 8 Mbps default", () => {
    const profile = deviceProfile(v12);
    expect(profile.MaxStreamingBitrate).toBe(1_000_000_000);
    expect(profile.MaxStaticBitrate).toBe(1_000_000_000);
  });

  test("lists every subtitle format mpv plays, with the mks VobSub sidecar only on 12+", () => {
    const shared = [
      ...[...TEXT, ...IMAGE].map((f) => `${f}|Embed|`),
      ...TEXT.map((f) => `${f}|External|`),
      "pgssub|External|",
    ];

    expect(subtitleRows(deviceProfile(v12))).toEqual([...shared, "dvdsub|External|mks"].sort());
    expect(subtitleRows(deviceProfile(v10))).toEqual([...shared].sort());
  });

  test("transcode fallback copies lossless and surround audio", () => {
    expect(deviceProfile(v12).TranscodingProfiles).toEqual([
      {
        Type: "Video",
        Container: "mp4",
        Protocol: "hls",
        VideoCodec: "h264,hevc",
        AudioCodec: "eac3,ac3,truehd,dts,flac,aac,opus",
        MaxAudioChannels: "8",
      },
    ]);
  });

  test("transcode codec lists fit the server's 40-character query validator", () => {
    const tooLong = (deviceProfile(v12).TranscodingProfiles ?? [])
      .flatMap((t) => [t.VideoCodec ?? "", t.AudioCodec ?? ""])
      .filter((csv) => !/^[a-zA-Z0-9\-._,|]{0,40}$/.test(csv));

    expect(tooLong).toEqual([]);
  });
});

describe("profileAllowsAllRanges (DV Profile 5 regression)", () => {
  test("rejects the jellyfin-desktop default that transcodes bare DOVI", () => {
    expect(profileAllowsAllRanges(jellyfinDesktopDefault)).toBe(false);
  });

  test("accepts our profile", () => {
    expect(profileAllowsAllRanges(deviceProfile(v12))).toBe(true);
  });

  test("ignores conditions on other properties", () => {
    const tenBitCap: DeviceProfile = {
      CodecProfiles: [
        {
          Type: "Video",
          Conditions: [{ Condition: "LessThanEqual", Property: "VideoBitDepth", Value: "8" }],
        },
      ],
    };

    expect(profileAllowsAllRanges(tenBitCap)).toBe(true);
  });
});

describe("ServerVersion", () => {
  test("parses the major from System/Info/Public Version", () => {
    expect(ServerVersion.parse("10.11.3")).toEqual({ major: 10 });
    expect(ServerVersion.safeParse("unknown").success).toBe(false);
  });
});

describe("playbackInfoRequest", () => {
  const userId = UserId.parse("5f2a9c1e0b7d4e3fa8c6d1b2e9f04a7c");

  test("asks for direct play at full bitrate and leaves subtitles to mpv", () => {
    const { DeviceProfile: _profile, ...body } = playbackInfoRequest({
      userId,
      server: v12,
      source: { kind: "default" },
    });

    expect(body).toEqual({
      UserId: "5f2a9c1e0b7d4e3fa8c6d1b2e9f04a7c",
      MaxStreamingBitrate: 1_000_000_000,
      EnableDirectPlay: true,
      EnableDirectStream: true,
      EnableTranscoding: true,
      AllowVideoStreamCopy: true,
      AllowAudioStreamCopy: true,
      AutoOpenLiveStream: true,
      SubtitleStreamIndex: -1,
    });
  });

  test("pairs an audio pick with its media source", () => {
    const body = playbackInfoRequest({
      userId,
      server: v12,
      source: { kind: "chosen", mediaSourceId: MediaSourceId.parse("src-1"), audioStreamIndex: 0 },
      startTimeTicks: 600_000_000,
    });

    expect([body.MediaSourceId, body.AudioStreamIndex, body.StartTimeTicks]).toEqual([
      "src-1",
      0,
      600_000_000,
    ]);
  });
});
