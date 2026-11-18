import type { MediaSourceInfo, MediaStream } from "@harakiri/jellyfin/generated";

export type PlayMethod = "DirectPlay" | "Transcode";

/** A selectable track, keyed both ways: Jellyfin's stream index and mpv's per-type track id. */
export interface Track {
  readonly index: number;
  readonly mpvId: number;
  readonly label: string;
}

export interface TrackTable {
  readonly audio: readonly Track[];
  readonly subtitles: readonly Track[];
  /** Sidecar subtitle URLs, in the order mpv must `sub-add` them after load for the ids above to hold. */
  readonly subtitleFiles: readonly string[];
}

const byIndex = (a: MediaStream, b: MediaStream) => (a.Index ?? 0) - (b.Index ?? 0);

const label = (stream: MediaStream): string =>
  stream.DisplayTitle ?? stream.Title ?? stream.Language ?? stream.Codec ?? `Track ${stream.Index}`;

const numbered = (streams: readonly MediaStream[], firstId: number): Track[] =>
  streams.map((stream, offset) => ({
    index: stream.Index ?? -1,
    mpvId: firstId + offset,
    label: label(stream),
  }));

/**
 * mpv numbers tracks per type from 1 in container order, then appends sidecar subtitles in load
 * order. Jellyfin indexes sidecars first and shifts the container streams up, so the two never
 * line up by number.
 *
 * A transcode is a fresh HLS stream carrying only the audio the server chose; the server then
 * delivers every subtitle as a sidecar, embedded ones included.
 */
export function trackTable(
  source: MediaSourceInfo,
  method: PlayMethod,
  serverUrl: string,
  transcodedAudioIndex?: number
): TrackTable {
  const streams = (source.MediaStreams ?? []).toSorted(byIndex);
  const embeddedAudio = streams.filter((s) => s.Type === "Audio" && !s.IsExternal);
  const subs = streams.filter((s) => s.Type === "Subtitle");

  const embeddedSubs = subs.filter(
    (s) => (s.DeliveryMethod ?? (s.IsExternal ? "External" : "Embed")) === "Embed"
  );

  const sidecars = subs.filter(
    (s) => s.DeliveryMethod === "External" && typeof s.DeliveryUrl === "string"
  );

  const audio =
    method === "DirectPlay"
      ? embeddedAudio
      : embeddedAudio.filter((s) => s.Index === transcodedAudioIndex).slice(0, 1);

  return {
    audio: numbered(audio, 1),
    subtitles: [...numbered(embeddedSubs, 1), ...numbered(sidecars, embeddedSubs.length + 1)],
    subtitleFiles: sidecars.map((s) => new URL(s.DeliveryUrl ?? "", serverUrl).toString()),
  };
}

/**
 * The mpv track id for a Jellyfin stream index. `false` turns the track off (Jellyfin's -1);
 * `undefined` leaves the choice to mpv.
 */
export function mpvTrack(
  tracks: readonly Track[],
  index: number | null | undefined
): number | false | undefined {
  if (index === null || index === undefined) {
    return undefined;
  }

  if (index < 0) {
    return false;
  }

  return tracks.find((track) => track.index === index)?.mpvId;
}
