import type { MediaSourceInfo, MediaStream } from "./generated/types.gen";

export type Resolution = "4K" | "1080p" | "720p" | "SD";

/** Which HDR format the Dolby Vision base layer carries on its own. */
export type DolbyVisionCompatibility = "none" | "HDR10" | "SDR" | "HLG";

/**
 * Native: the picture reaches the display as it is.
 * Mapped: harakiri converts it on purpose and delivers HDR10 (PQ).
 */
export type PictureClass =
  | { readonly range: "SDR"; readonly resolution: Resolution | null; readonly delivery: "native" }
  | { readonly range: "HDR10"; readonly resolution: Resolution | null; readonly delivery: "native" }
  | {
      readonly range: "HDR10+";
      readonly resolution: Resolution | null;
      readonly delivery: "native";
    }
  | { readonly range: "HLG"; readonly resolution: Resolution | null; readonly delivery: "mapped" }
  | {
      readonly range: "Dolby Vision";
      readonly resolution: Resolution | null;
      readonly delivery: "mapped";
      readonly profile: number | null;
      readonly compatibility: DolbyVisionCompatibility;
      readonly hdr10Plus: boolean;
      /** Profile 7 with an enhancement layer: mpv 0.41 plays the base layer plus RPU only. */
      readonly playback: "complete" | "base-layer-only";
    };

export type SoundFormat =
  | "TrueHD Atmos"
  | "TrueHD"
  | "DTS:X"
  | "DTS-HD MA"
  | "DTS-HD HRA"
  | "DTS"
  | "E-AC3 Atmos"
  | "E-AC3"
  | "AC3"
  | "PCM"
  | "FLAC"
  | "Opus"
  | "AAC"
  | "Other";

/**
 * Native: a bitstream the receiver decodes, or PCM that passes as it is.
 * Decoded: mpv decodes a format that cannot be bitstreamed to PCM.
 */
export type SoundClass = {
  readonly format: SoundFormat;
  /** The server's codec name, the label when the format is "Other". */
  readonly codec: string;
  /** "7.1", "5.1", "5.1.2", "2.0", "1.0". */
  readonly channels: string | null;
  readonly delivery: "native" | "decoded";
  readonly streamIndex: number;
};

/** How a leg of the signal path reaches the TV or receiver (PRD signal-path vocabulary). */
export const signalStates = ["native", "mapped", "decoded"] as const;
export type SignalState = (typeof signalStates)[number];

/** One leg of the signal path with how it reaches the TV or receiver. */
export type SignalFact = {
  readonly text: string;
  readonly state: SignalState;
};

/** The facts as one line, e.g. "Dolby Vision mapped to HDR10 · TrueHD Atmos bitstream". */
export const joinFacts = (facts: readonly SignalFact[]): string =>
  facts.map((fact) => fact.text).join(" · ");

export type Fidelity = {
  readonly picture: PictureClass;
  readonly sound: SoundClass | null;
  /** The signal path as facts: the picture leg, then the sound leg when there is sound. */
  readonly signal: readonly SignalFact[];
  /** The programme note, e.g. "4K Dolby Vision · TrueHD Atmos 7.1". */
  readonly notes: string;
  /** The screening-handoff slug, e.g. "Dolby Vision mapped to HDR10 · TrueHD Atmos bitstream". */
  readonly signalPath: string;
};

type SoundTraits = { readonly rank: number; readonly delivery: SoundClass["delivery"] };

// rank breaks ties between tracks with the same spatial format and channel count.
const SOUND: Record<SoundFormat, SoundTraits> = {
  "TrueHD Atmos": { rank: 0, delivery: "native" },
  "DTS:X": { rank: 1, delivery: "native" },
  TrueHD: { rank: 2, delivery: "native" },
  "DTS-HD MA": { rank: 3, delivery: "native" },
  PCM: { rank: 4, delivery: "native" },
  FLAC: { rank: 5, delivery: "decoded" },
  "E-AC3 Atmos": { rank: 6, delivery: "native" },
  "DTS-HD HRA": { rank: 7, delivery: "native" },
  "E-AC3": { rank: 8, delivery: "native" },
  DTS: { rank: 9, delivery: "native" },
  AC3: { rank: 10, delivery: "native" },
  Opus: { rank: 11, delivery: "decoded" },
  AAC: { rank: 12, delivery: "decoded" },
  Other: { rank: 13, delivery: "decoded" },
};

const CHANNELS_BY_COUNT: Record<number, string> = {
  1: "1.0",
  2: "2.0",
  3: "2.1",
  4: "4.0",
  5: "5.0",
  6: "5.1",
  7: "6.1",
  8: "7.1",
};

const NAMED_LAYOUTS: Record<string, string> = { mono: "1.0", stereo: "2.0", quad: "4.0" };

const resolutionOf = (stream: MediaStream): Resolution | null => {
  const width = stream.Width ?? 0;
  const height = stream.Height ?? 0;
  if (width === 0 && height === 0) return null;
  // Width first: scope films are letterboxed (3840x1600 is still 4K).
  if (width >= 3200 || height >= 1800) return "4K";
  if (width >= 1800 || height >= 1000) return "1080p";
  if (width >= 1200 || height >= 700) return "720p";
  return "SD";
};

const dolbyVision = (
  stream: MediaStream,
  resolution: Resolution | null,
  compatibility: DolbyVisionCompatibility,
  options: { hdr10Plus?: boolean; enhancementLayer?: boolean } = {},
): PictureClass => ({
  range: "Dolby Vision",
  resolution,
  delivery: "mapped",
  profile: stream.DvProfile ?? null,
  compatibility,
  hdr10Plus: options.hdr10Plus ?? stream.Hdr10PlusPresentFlag === true,
  playback: options.enhancementLayer === true ? "base-layer-only" : "complete",
});

// The server's own range classification is the source of truth. A DOVIInvalid
// record (a stale DV header on an SDR stream) falls back to the plain range.
const pictureOf = (stream: MediaStream): PictureClass => {
  const resolution = resolutionOf(stream);
  const plain = (): PictureClass => {
    if (stream.VideoRange !== "HDR") return { range: "SDR", resolution, delivery: "native" };
    if (stream.ColorTransfer === "arib-std-b67")
      return { range: "HLG", resolution, delivery: "mapped" };
    return { range: "HDR10", resolution, delivery: "native" };
  };
  const rangeType = stream.VideoRangeType ?? "Unknown";
  switch (rangeType) {
    case "SDR":
      return { range: "SDR", resolution, delivery: "native" };
    case "HDR10":
      return { range: "HDR10", resolution, delivery: "native" };
    case "HDR10Plus":
      return { range: "HDR10+", resolution, delivery: "native" };
    case "HLG":
      return { range: "HLG", resolution, delivery: "mapped" };
    case "DOVI":
      return dolbyVision(stream, resolution, "none");
    case "DOVIWithHDR10":
      return dolbyVision(stream, resolution, "HDR10");
    case "DOVIWithHDR10Plus":
      return dolbyVision(stream, resolution, "HDR10", { hdr10Plus: true });
    case "DOVIWithSDR":
      return dolbyVision(stream, resolution, "SDR");
    case "DOVIWithHLG":
      return dolbyVision(stream, resolution, "HLG");
    case "DOVIWithEL":
      return dolbyVision(stream, resolution, "HDR10", { enhancementLayer: true });
    case "DOVIWithELHDR10Plus":
      return dolbyVision(stream, resolution, "HDR10", { hdr10Plus: true, enhancementLayer: true });
    case "DOVIInvalid":
    case "Unknown":
      return plain();
    default: {
      const unhandled: never = rangeType;
      return unhandled;
    }
  }
};

const soundFormatOf = (stream: MediaStream): SoundFormat => {
  const codec = (stream.Codec ?? "").toLowerCase();
  const profile = stream.Profile ?? "";
  const atmos = stream.AudioSpatialFormat === "DolbyAtmos" || profile.includes("Atmos");
  if (codec === "truehd") return atmos ? "TrueHD Atmos" : "TrueHD";
  if (codec === "eac3") return atmos ? "E-AC3 Atmos" : "E-AC3";
  if (codec === "ac3") return "AC3";
  if (codec === "dts") {
    if (stream.AudioSpatialFormat === "DTSX" || profile.includes("DTS:X")) return "DTS:X";
    if (profile.includes("MA")) return "DTS-HD MA";
    if (profile.includes("HRA")) return "DTS-HD HRA";
    return "DTS";
  }
  if (codec.startsWith("pcm")) return "PCM";
  if (codec === "flac") return "FLAC";
  if (codec === "opus") return "Opus";
  if (codec === "aac") return "AAC";
  return "Other";
};

const channelsOf = (stream: MediaStream): string | null => {
  const layout = (stream.ChannelLayout ?? "").replace(/\(.*\)$/, "");
  if (/^\d+\.\d(\.\d)?$/.test(layout)) return layout;
  const named = NAMED_LAYOUTS[layout];
  if (named !== undefined) return named;
  return CHANNELS_BY_COUNT[stream.Channels ?? 0] ?? null;
};

const soundOf = (stream: MediaStream): SoundClass => {
  const format = soundFormatOf(stream);
  return {
    format,
    codec: stream.Codec ?? "",
    channels: channelsOf(stream),
    delivery: SOUND[format].delivery,
    streamIndex: stream.Index ?? -1,
  };
};

const isSpatial = (sound: SoundClass): boolean =>
  sound.format === "TrueHD Atmos" || sound.format === "DTS:X" || sound.format === "E-AC3 Atmos";

const channelCount = (sound: SoundClass): number =>
  (sound.channels ?? "0").split(".").reduce((sum, part) => sum + Number(part), 0);

// The note states what the film offers at its best: object audio first, then
// the widest layout, then the stronger format.
const compareSound = (a: SoundClass, b: SoundClass): number =>
  Number(isSpatial(b)) - Number(isSpatial(a)) ||
  channelCount(b) - channelCount(a) ||
  SOUND[a.format].rank - SOUND[b.format].rank;

const pictureLabel = (picture: PictureClass): string =>
  picture.range === "Dolby Vision" && picture.playback === "base-layer-only"
    ? "Dolby Vision (base layer)"
    : picture.range;

const soundLabel = (sound: SoundClass): string =>
  sound.format === "Other" ? sound.codec.toUpperCase() : sound.format;

const pictureSignal = (picture: PictureClass): string => {
  if (picture.delivery === "native") return picture.range;
  if (picture.range === "Dolby Vision" && picture.playback === "base-layer-only")
    return "Dolby Vision base layer mapped to HDR10";
  return `${picture.range} mapped to HDR10`;
};

const soundSignal = (sound: SoundClass): string => {
  if (sound.delivery === "decoded") return `${soundLabel(sound)} decoded to PCM`;
  if (sound.format === "PCM") return "PCM";
  return `${soundLabel(sound)} bitstream`;
};

const join = (...parts: (string | null)[]): string =>
  parts.filter((part): part is string => part !== null && part !== "").join(" ");

/**
 * Classifies a media source into its picture and sound class.
 * Sound describes `audioStreamIndex` when given, otherwise the best track.
 * Returns null when the server has not probed the file yet (no video stream).
 */
export const classifyFidelity = (
  source: MediaSourceInfo | undefined,
  options: { readonly audioStreamIndex?: number } = {},
): Fidelity | null => {
  const streams = source?.MediaStreams ?? [];
  const video = streams.find((stream) => stream.Type === "Video");
  if (video === undefined) return null;
  const picture = pictureOf(video);
  const tracks = streams.filter((stream) => stream.Type === "Audio").map(soundOf);
  const chosen =
    options.audioStreamIndex === undefined
      ? tracks.toSorted(compareSound)[0]
      : tracks.find((track) => track.streamIndex === options.audioStreamIndex);
  const sound = chosen ?? null;
  const pictureNote = join(picture.resolution, pictureLabel(picture));
  const signal: SignalFact[] = [{ text: pictureSignal(picture), state: picture.delivery }];
  if (sound !== null) signal.push({ text: soundSignal(sound), state: sound.delivery });
  return {
    picture,
    sound,
    signal,
    notes:
      sound === null ? pictureNote : `${pictureNote} · ${join(soundLabel(sound), sound.channels)}`,
    signalPath: signal.map((fact) => fact.text).join(" · "),
  };
};
