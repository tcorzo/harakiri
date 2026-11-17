import { z } from "zod";
import type { DeviceProfile, PlaybackInfoDto, SubtitleProfile } from "./generated/types.gen";
import type { MediaSourceId, UserId } from "./ids";

// The server defaults to 8 Mbps when this is omitted and assumes 40 Mbps for
// files with unknown bitrate, so both silently force transcodes.
export const MAX_STREAMING_BITRATE = 1_000_000_000;

export const ServerVersion = z
  .string()
  .regex(/^\d+\.\d+\.\d+/)
  .transform((raw) => ({ major: Number(raw.split(".")[0]) }));
export type ServerVersion = z.output<typeof ServerVersion>;

type SubtitleRule = {
  readonly format: string;
  readonly method: "Embed" | "External";
  readonly container?: string;
  readonly minServerMajor?: number;
};

const TEXT_FORMATS = [
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
const IMAGE_FORMATS = ["pgssub", "pgs", "dvdsub", "vobsub", "dvbsub"];

// The server matches Format with string equality, so there is no wildcard.
// A selected stream without a rule here is burned in (SubtitleCodecNotSupported).
const SUBTITLE_RULES: readonly SubtitleRule[] = [
  ...[...TEXT_FORMATS, ...IMAGE_FORMATS].map((format) => ({ format, method: "Embed" as const })),
  ...TEXT_FORMATS.map((format) => ({ format, method: "External" as const })),
  { format: "pgssub", method: "External" },
  // 10.x ignores Container and hands out sidecar URLs that 404.
  { format: "dvdsub", method: "External", container: "mks", minServerMajor: 12 },
];

const subtitleProfiles = (server: ServerVersion): SubtitleProfile[] =>
  SUBTITLE_RULES.filter((rule) => server.major >= (rule.minServerMajor ?? 0)).map(
    ({ format, method, container }) =>
      container === undefined
        ? { Format: format, Method: method }
        : { Format: format, Method: method, Container: container },
  );

export const deviceProfile = (server: ServerVersion): DeviceProfile => ({
  Name: "Harakiri",
  MaxStreamingBitrate: MAX_STREAMING_BITRATE,
  MaxStaticBitrate: MAX_STREAMING_BITRATE,
  MaxStaticMusicBitrate: MAX_STREAMING_BITRATE,
  // Empty Container/codec fields mean "accept all" to the server.
  DirectPlayProfiles: [{ Type: "Video" }, { Type: "Audio" }, { Type: "Photo" }],
  ContainerProfiles: [],
  // Any condition here, VideoRangeType above all, reintroduces the DV Profile 5 transcode.
  CodecProfiles: [],
  SubtitleProfiles: subtitleProfiles(server),
  TranscodingProfiles: [
    {
      Type: "Video",
      // fMP4 HLS, because MPEG-TS cannot carry TrueHD or DTS for the copy path.
      Container: "mp4",
      Protocol: "hls",
      // The server encodes to the first entry and does not check encoder support.
      VideoCodec: "h264,hevc",
      // Listed codecs are stream-copied; eac3 is the encode target for anything else.
      AudioCodec: "eac3,ac3,truehd,dts,flac,aac,opus",
      MaxAudioChannels: "8",
    },
  ],
});

export const profileAllowsAllRanges = (profile: DeviceProfile): boolean =>
  (profile.CodecProfiles ?? []).every((codec) =>
    (codec.Conditions ?? []).every((condition) => condition.Property !== "VideoRangeType"),
  );

export type PlaybackSource =
  | { readonly kind: "default" }
  // The server ignores AudioStreamIndex unless MediaSourceId is also sent.
  | {
      readonly kind: "chosen";
      readonly mediaSourceId: MediaSourceId;
      readonly audioStreamIndex?: number;
    };

export type PlaybackInfoRequestInput = {
  readonly userId: UserId;
  readonly server: ServerVersion;
  readonly source: PlaybackSource;
  readonly startTimeTicks?: number;
};

export const playbackInfoRequest = ({
  userId,
  server,
  source,
  startTimeTicks,
}: PlaybackInfoRequestInput): PlaybackInfoDto => ({
  UserId: userId,
  DeviceProfile: deviceProfile(server),
  // The request value overrides the profile's, so it must be sent here too.
  MaxStreamingBitrate: MAX_STREAMING_BITRATE,
  EnableDirectPlay: true,
  EnableDirectStream: true,
  EnableTranscoding: true,
  AllowVideoStreamCopy: true,
  AllowAudioStreamCopy: true,
  AutoOpenLiveStream: true,
  // mpv selects subtitles itself; a server-side pick can force a burn-in.
  SubtitleStreamIndex: -1,
  ...(startTimeTicks === undefined ? {} : { StartTimeTicks: startTimeTicks }),
  ...(source.kind === "chosen" ? { MediaSourceId: source.mediaSourceId } : {}),
  ...(source.kind === "chosen" && source.audioStreamIndex !== undefined
    ? { AudioStreamIndex: source.audioStreamIndex }
    : {}),
});
