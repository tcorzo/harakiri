import { match } from "ts-pattern";
import { z } from "zod";
import { mediaSource } from "./dto";
import type { EpisodeItem, MovieItem } from "./library";
import type { MediaStream } from "./probe";
import { hex32 } from "./state";

/**
 * POST /Items/{id}/PlaybackInfo. Real Jellyfin runs its StreamBuilder over the DeviceProfile; the
 * fake applies the cheap subset of the same rules, enough to answer the profiles the app and its
 * tests send: the bitrate cap, DirectPlayProfiles (container and codecs), and CodecProfile
 * conditions on the video range, resolution, bit depth and audio channels. Any failure turns the
 * answer into a transcode with Jellyfin's TranscodeReasons. The fake never serves that transcode;
 * only the contract tier against a real server proves what Jellyfin itself decides.
 */

const Condition = z.object({
  Condition: z.string(),
  Property: z.string(),
  Value: z.string().nullish(),
  IsRequired: z.boolean().nullish(),
});

const CodecProfile = z.object({
  Type: z.string(),
  Codec: z.string().nullish(),
  Container: z.string().nullish(),
  Conditions: z.array(Condition).nullish(),
  ApplyConditions: z.array(Condition).nullish(),
});

const DirectPlayProfile = z.object({
  Container: z.string().nullish(),
  Type: z.string(),
  VideoCodec: z.string().nullish(),
  AudioCodec: z.string().nullish(),
});

const TranscodingProfile = z.object({
  Type: z.string(),
  Container: z.string().nullish(),
  Protocol: z.string().nullish(),
  VideoCodec: z.string().nullish(),
  AudioCodec: z.string().nullish(),
});

const SubtitleProfile = z.object({
  Format: z.string().nullish(),
  Method: z.string().nullish(),
  Container: z.string().nullish(),
});

const DeviceProfile = z.object({
  MaxStreamingBitrate: z.number().nullish(),
  MaxStaticBitrate: z.number().nullish(),
  DirectPlayProfiles: z.array(DirectPlayProfile).nullish(),
  TranscodingProfiles: z.array(TranscodingProfile).nullish(),
  CodecProfiles: z.array(CodecProfile).nullish(),
  SubtitleProfiles: z.array(SubtitleProfile).nullish(),
});

export const PlaybackInfoBody = z.object({
  UserId: z.string().nullish(),
  MaxStreamingBitrate: z.number().nullish(),
  StartTimeTicks: z.number().nullish(),
  AudioStreamIndex: z.number().int().nullish(),
  SubtitleStreamIndex: z.number().int().nullish(),
  MediaSourceId: z.string().nullish(),
  DeviceProfile: DeviceProfile.nullish(),
  EnableDirectPlay: z.boolean().nullish(),
  EnableDirectStream: z.boolean().nullish(),
  EnableTranscoding: z.boolean().nullish(),
});
export type PlaybackInfoBody = z.infer<typeof PlaybackInfoBody>;

type Condition = z.infer<typeof Condition>;

const list = (value: string | null | undefined): string[] =>
  (value ?? "")
    .split(/[,|]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== "");

const matchesList = (value: string, allowed: string | null | undefined) => {
  const wanted = list(allowed);
  return wanted.length === 0 || wanted.includes(value.toLowerCase());
};

/** A profile Container against the item's format list ("mov,mp4,..."): any one may match. */
const supportsContainer = (formats: string, allowed: string | null | undefined) =>
  list(formats).some((format) => matchesList(format, allowed));

// StreamBuilder's HLS codec allowlists, by segment container.
const HLS_VIDEO = ["h264", "hevc", "vp9", "av1"];
const HLS_AUDIO_TS = ["aac", "ac3", "eac3", "mp3"];
const HLS_AUDIO_MP4 = [...HLS_AUDIO_TS, "alac", "flac", "opus", "dts", "truehd"];

/** Jellyfin's ProfileConditionValue names, read off the stream the condition applies to. */
function property(name: string, video: MediaStream | undefined, audio: MediaStream | undefined) {
  return match(name)
    .with("VideoRangeType", () => video?.["VideoRangeType"])
    .with("VideoRange", () => video?.["VideoRange"])
    .with("Width", () => video?.["Width"])
    .with("Height", () => video?.["Height"])
    .with("VideoBitDepth", () => video?.["BitDepth"])
    .with("VideoProfile", () => video?.["Profile"])
    .with("VideoLevel", () => video?.["Level"])
    .with("AudioChannels", () => audio?.["Channels"])
    .with("AudioProfile", () => audio?.["Profile"])
    .otherwise(() => undefined);
}

function holds(condition: Condition, actual: unknown): boolean {
  if (actual === undefined || actual === null) return condition.IsRequired !== true;
  const value = condition.Value ?? "";
  const text = (
    typeof actual === "string" || typeof actual === "number" || typeof actual === "boolean"
      ? String(actual)
      : JSON.stringify(actual)
  ).toLowerCase();
  return match(condition.Condition)
    .with("Equals", () => text === value.toLowerCase())
    .with("NotEquals", () => text !== value.toLowerCase())
    .with("EqualsAny", () => list(value).includes(text))
    .with("LessThanEqual", () => Number(actual) <= Number(value))
    .with("GreaterThanEqual", () => Number(actual) >= Number(value))
    .otherwise(() => true);
}

const REASON: Readonly<Record<string, string>> = {
  VideoRangeType: "VideoRangeTypeNotSupported",
  VideoRange: "VideoRangeTypeNotSupported",
  Width: "VideoResolutionNotSupported",
  Height: "VideoResolutionNotSupported",
  VideoBitDepth: "VideoBitDepthNotSupported",
  VideoProfile: "VideoProfileNotSupported",
  VideoLevel: "VideoLevelNotSupported",
  AudioChannels: "AudioChannelsNotSupported",
  AudioProfile: "AudioProfileNotSupported",
};

/** The TranscodeReasons the profile gives this file; empty means it direct plays. */
export function transcodeReasons(
  item: MovieItem | EpisodeItem,
  body: PlaybackInfoBody,
  audioIndex: number | undefined,
): string[] {
  const streams = item.probed.streams;
  const video = streams.find((s) => s.Type === "Video");
  const audio =
    streams.find((s) => s.Type === "Audio" && s.Index === audioIndex) ??
    streams.find((s) => s.Type === "Audio");
  const profile = body.DeviceProfile;
  const reasons = new Set<string>();
  const cap = body.MaxStreamingBitrate ?? profile?.MaxStreamingBitrate ?? undefined;
  if (cap != null && item.probed.bitrate !== undefined && item.probed.bitrate > cap) {
    reasons.add("ContainerBitrateExceedsLimit");
  }
  const directPlay = profile?.DirectPlayProfiles ?? [];
  const videoProfiles = directPlay.filter((p) => p.Type === "Video");
  if (profile != null && videoProfiles.length === 0) reasons.add("ContainerNotSupported");
  else if (videoProfiles.length > 0) {
    const byContainer = videoProfiles.filter((p) => supportsContainer(item.formats, p.Container));
    if (byContainer.length === 0) reasons.add("ContainerNotSupported");
    else {
      if (video && !byContainer.some((p) => matchesList(video.Codec, p.VideoCodec)))
        reasons.add("VideoCodecNotSupported");
      if (audio && !byContainer.some((p) => matchesList(audio.Codec, p.AudioCodec)))
        reasons.add("AudioCodecNotSupported");
    }
  }
  for (const codecProfile of profile?.CodecProfiles ?? []) {
    const stream = codecProfile.Type === "Video" ? video : audio;
    if (stream === undefined) continue;
    if (!matchesList(stream.Codec, codecProfile.Codec)) continue;
    if (!matchesList(item.container, codecProfile.Container)) continue;
    const applies = (codecProfile.ApplyConditions ?? []).every((c) =>
      holds(c, property(c.Property, video, audio)),
    );
    if (!applies) continue;
    for (const condition of codecProfile.Conditions ?? []) {
      if (!holds(condition, property(condition.Property, video, audio))) {
        reasons.add(REASON[condition.Property] ?? "UnknownVideoStreamInfo");
      }
    }
  }
  return [...reasons];
}

type Transcoding = z.infer<typeof TranscodingProfile>;

/**
 * What StreamBuilder adds once a file transcodes (BuildStreamVideoItem): the video codec must be
 * one the HLS profile can copy or encode, and with no audio index asked for, only the file's
 * default-flagged audio streams are candidates (the user plays the default track), so a file whose
 * audio is not flagged default also gets AudioCodecNotSupported.
 */
function transcodeOnlyReasons(
  item: MovieItem | EpisodeItem,
  body: PlaybackInfoBody,
  target: Transcoding,
  audioIndex: number | undefined,
): string[] {
  const streams = item.probed.streams;
  const video = streams.find((s) => s.Type === "Video");
  const audio = streams.find((s) => s.Type === "Audio" && s.Index === audioIndex);
  const hls = target.Protocol?.toLowerCase() === "hls";
  const reasons: string[] = [];
  let videoCodecs = list(target.VideoCodec);
  if (videoCodecs.length === 0 && video) videoCodecs = [video.Codec.toLowerCase()];
  if (hls) videoCodecs = videoCodecs.filter((c) => HLS_VIDEO.includes(c));
  if (video && !videoCodecs.includes(video.Codec.toLowerCase()))
    reasons.push("VideoCodecNotSupported");
  let audioCodecs = list(target.AudioCodec);
  if (audioCodecs.length === 0 && audio) audioCodecs = [audio.Codec.toLowerCase()];
  if (hls) {
    const allowed = target.Container?.toLowerCase() === "mp4" ? HLS_AUDIO_MP4 : HLS_AUDIO_TS;
    audioCodecs = audioCodecs.filter((c) => allowed.includes(c));
  }
  const explicit = body.AudioStreamIndex != null && body.AudioStreamIndex >= 0;
  const candidates = explicit
    ? audio === undefined
      ? []
      : [audio]
    : streams.filter((s) => s.Type === "Audio" && s.IsDefault === true);
  if (audio && !candidates.some((s) => audioCodecs.includes(s.Codec.toLowerCase())))
    reasons.push("AudioCodecNotSupported");
  return reasons;
}

const dashed = (id: string) =>
  `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;

export function playbackInfo(
  item: MovieItem | EpisodeItem,
  body: PlaybackInfoBody,
  token: string,
  deviceId: string,
) {
  const playSessionId = hex32();
  const profile = body.DeviceProfile ?? undefined;
  const fallback = mediaSource(item)["DefaultAudioStreamIndex"];
  const audioIndex = body.AudioStreamIndex ?? (typeof fallback === "number" ? fallback : undefined);
  const reasons = transcodeReasons(item, body, audioIndex);
  const delivery = (transcodingHls: boolean, container: string) =>
    profile === undefined
      ? undefined
      : { token, profiles: profile.SubtitleProfiles ?? [], transcodingHls, container };
  if (reasons.length === 0) {
    // Direct play names one container: the first of the item's formats the profile accepts.
    const accepted = (profile?.DirectPlayProfiles ?? []).filter((p) => p.Type === "Video");
    const container =
      profile === undefined
        ? item.container
        : (list(item.formats).find((f) => accepted.some((p) => matchesList(f, p.Container))) ??
          item.container);
    const source = { ...mediaSource(item, delivery(false, container)), Container: container };
    return { MediaSources: [source], PlaySessionId: playSessionId };
  }
  const target = (profile?.TranscodingProfiles ?? []).find((p) => p.Type === "Video");
  const all = [
    ...new Set([
      ...reasons,
      ...(target === undefined ? [] : transcodeOnlyReasons(item, body, target, audioIndex)),
    ]),
  ];
  const hls = target?.Protocol?.toLowerCase() === "hls";
  const segment = target?.Container ?? "ts";
  const query = new URLSearchParams({
    DeviceId: deviceId,
    MediaSourceId: item.id,
    VideoCodec: target?.VideoCodec ?? "h264",
    AudioCodec: target?.AudioCodec ?? "aac",
    ...(audioIndex === undefined ? {} : { AudioStreamIndex: String(audioIndex) }),
    SegmentContainer: segment,
    PlaySessionId: playSessionId,
    ApiKey: token,
    TranscodeReasons: all.join(","),
  });
  return {
    MediaSources: [
      {
        ...mediaSource(item, delivery(hls, segment)),
        SupportsDirectStream: false,
        SupportsDirectPlay: false,
        TranscodingUrl: `/videos/${dashed(item.id)}/master.m3u8?${query.toString()}`,
        TranscodingSubProtocol: hls ? "hls" : "http",
        TranscodingContainer: segment,
      },
    ],
    PlaySessionId: playSessionId,
  };
}
