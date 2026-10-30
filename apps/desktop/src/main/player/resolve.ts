import type {
  BaseItemDto,
  MediaSourceInfo,
  PlaybackInfoResponse,
  TranscodeReason,
} from "@harakiri/jellyfin/generated";
import { ItemId, MediaSourceId, type ServerUrl, staticStreamUrl } from "@harakiri/jellyfin";
import { mpvTrack, type PlayMethod, type TrackTable, trackTable } from "./tracks";

const REASONS: Readonly<Record<TranscodeReason, string>> = {
  ContainerNotSupported: "Container not supported",
  VideoCodecNotSupported: "Video codec not supported",
  AudioCodecNotSupported: "Audio codec not supported",
  SubtitleCodecNotSupported: "Subtitles burned in",
  AudioIsExternal: "Audio is a separate file",
  SecondaryAudioNotSupported: "Secondary audio not supported",
  VideoProfileNotSupported: "Video profile not supported",
  VideoLevelNotSupported: "Video level not supported",
  VideoResolutionNotSupported: "Resolution over the limit",
  VideoBitDepthNotSupported: "Video bit depth not supported",
  VideoFramerateNotSupported: "Frame rate not supported",
  RefFramesNotSupported: "Too many reference frames",
  AnamorphicVideoNotSupported: "Anamorphic video not supported",
  InterlacedVideoNotSupported: "Interlaced video not supported",
  AudioChannelsNotSupported: "Too many audio channels",
  AudioProfileNotSupported: "Audio profile not supported",
  AudioSampleRateNotSupported: "Audio sample rate not supported",
  AudioBitDepthNotSupported: "Audio bit depth not supported",
  ContainerBitrateExceedsLimit: "Bitrate over the limit",
  VideoBitrateNotSupported: "Video bitrate over the limit",
  AudioBitrateNotSupported: "Audio bitrate over the limit",
  UnknownVideoStreamInfo: "Video stream not identified",
  UnknownAudioStreamInfo: "Audio stream not identified",
  DirectPlayError: "Direct play failed",
  VideoRangeTypeNotSupported: "HDR format not supported",
  VideoCodecTagNotSupported: "Video codec tag not supported",
  StreamCountExceedsLimit: "Too many streams",
  VideoRotationNotSupported: "Rotated video not supported",
};

const isReason = (raw: string): raw is TranscodeReason => Object.hasOwn(REASONS, raw);

/** The server lists its reasons only inside the TranscodingUrl query. */
export function transcodeReasons(transcodingUrl: string): string[] {
  const raw = new URL(transcodingUrl, "http://x/").searchParams.get("TranscodeReasons") ?? "";
  return raw
    .split(",")
    .filter((reason) => reason !== "")
    .map((reason) => (isReason(reason) ? REASONS[reason] : reason));
}

const ERRORS: Readonly<Record<NonNullable<PlaybackInfoResponse["ErrorCode"]>, string>> = {
  NotAllowed: "The server does not allow this user to play it",
  NoCompatibleStream: "The server found no playable stream",
  RateLimitExceeded: "The server's streaming limit is reached",
};

export interface ResolveRequest {
  readonly itemId: string;
  readonly mediaSourceId?: string | undefined;
  readonly audioStreamIndex?: number | undefined;
  readonly subtitleStreamIndex?: number | undefined;
}

export interface Resolution {
  readonly source: MediaSourceInfo;
  readonly method: PlayMethod;
  readonly url: string;
  readonly playSessionId: string | undefined;
  readonly mediaSourceId: string;
  readonly transcodeReasons: readonly string[];
  /** The server transcodes and holds no stream information for the file: it could not read it. */
  readonly unreadable: boolean;
  readonly tracks: TrackTable;
  /** Jellyfin stream indices, as reported back in Sessions/Playing. */
  readonly audioStreamIndex: number | undefined;
  readonly subtitleStreamIndex: number | undefined;
  readonly aid: number | false | undefined;
  readonly sid: number | false | undefined;
  readonly durationTicks: number | undefined;
}

/** Picks the media source and the URL mpv plays from a PlaybackInfo response. */
export function resolve(
  response: PlaybackInfoResponse,
  request: ResolveRequest,
  server: ServerUrl,
): Resolution {
  if (response.ErrorCode) throw new Error(ERRORS[response.ErrorCode]);
  const sources = response.MediaSources ?? [];
  const source = sources.find((s) => s.Id === request.mediaSourceId) ?? sources[0];
  if (!source?.Id) throw new Error("The server returned no media source");

  const transcodingUrl = source.TranscodingUrl ?? undefined;
  const method: PlayMethod = transcodingUrl === undefined ? "DirectPlay" : "Transcode";
  const transcodedAudio = transcodingUrl
    ? Number(new URL(transcodingUrl, server).searchParams.get("AudioStreamIndex") ?? Number.NaN)
    : Number.NaN;
  const audioStreamIndex = Number.isNaN(transcodedAudio)
    ? (request.audioStreamIndex ?? source.DefaultAudioStreamIndex ?? undefined)
    : transcodedAudio;
  const subtitleStreamIndex =
    request.subtitleStreamIndex ?? source.DefaultSubtitleStreamIndex ?? undefined;
  const tracks = trackTable(source, method, server, audioStreamIndex);
  const streams = source.MediaStreams ?? [];

  return {
    source,
    method,
    url:
      transcodingUrl === undefined
        ? staticStreamUrl({
            server,
            itemId: ItemId.parse(request.itemId),
            mediaSourceId: MediaSourceId.parse(source.Id),
          })
        : new URL(transcodingUrl, server).toString(),
    playSessionId: response.PlaySessionId ?? undefined,
    mediaSourceId: source.Id,
    transcodeReasons: transcodingUrl === undefined ? [] : transcodeReasons(transcodingUrl),
    // A direct play needs no stream information from the server: mpv reads the file itself.
    unreadable:
      method === "Transcode" &&
      !streams.some((stream) => stream.Type === "Video" || stream.Type === "Audio"),
    tracks,
    audioStreamIndex,
    subtitleStreamIndex,
    aid: mpvTrack(tracks.audio, audioStreamIndex),
    sid: mpvTrack(tracks.subtitles, subtitleStreamIndex),
    durationTicks: source.RunTimeTicks ?? undefined,
  };
}

export interface ProgrammeEntry {
  readonly title: string;
  readonly programme: string;
}

const runtime = (ticks: number | null | undefined): string | undefined => {
  if (!ticks) return undefined;
  const minutes = Math.round(ticks / 600_000_000);
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `${minutes} min` : `${hours} h ${minutes % 60} min`;
};

/** The title and the one-line programme note the player controls show. */
export function programmeEntry(item: BaseItemDto): ProgrammeEntry {
  const name = item.Name ?? "Untitled";
  if (item.Type === "Episode") {
    const number =
      item.ParentIndexNumber != null && item.IndexNumber != null
        ? `S${item.ParentIndexNumber} E${item.IndexNumber}`
        : undefined;
    return {
      title: item.SeriesName ?? name,
      programme: [number, name, runtime(item.RunTimeTicks)].filter(Boolean).join(" · "),
    };
  }
  return {
    title: name,
    programme: [item.ProductionYear?.toString(), runtime(item.RunTimeTicks), item.OfficialRating]
      .filter(Boolean)
      .join(" · "),
  };
}
