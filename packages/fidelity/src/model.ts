/** Compressed formats an output can take as an IEC 61937 bitstream, named as mpv's `--audio-spdif`. */
export type BitstreamCodec = "ac3" | "eac3" | "dts" | "dts-hd" | "truehd";

export type PictureRange = "SDR" | "HDR10" | "HDR10+" | "HLG" | "Dolby Vision";

export interface PictureSource {
  readonly range: PictureRange;
  /** How the facts name it, e.g. "Dolby Vision" or "Dolby Vision base layer". */
  readonly label: string;
}

/**
 * How a sound track reaches the receiver at best: as a bitstream it decodes itself, as PCM that
 * passes as it is, or decoded by mpv because the format cannot be bitstreamed (FLAC, AAC, Opus).
 */
export type SoundCarriage = BitstreamCodec | "pcm" | "decode";

export interface SoundSource {
  readonly carriage: SoundCarriage;
  /** How the facts name it, e.g. "TrueHD Atmos 7.1". */
  readonly label: string;
}

/** What the server sends: the file as it is, or its own transcode of it. */
export type Delivery =
  | { readonly kind: "direct" }
  | {
      readonly kind: "transcode";
      readonly reasons: readonly string[];
      readonly picture: PictureSource | null;
      readonly sound: SoundSource | null;
    };

export type AudioOutput =
  | { readonly kind: "known"; readonly name: string; readonly bitstream: readonly BitstreamCodec[] }
  | { readonly kind: "unknown"; readonly detail: string };

/** mpv's renderers, best first. Only Vulkan can hand HDR to the compositor. */
export const renderers = ["vulkan", "opengl", "opengl-legacy"] as const;
export type Renderer = (typeof renderers)[number];

/** PRD signal-path vocabulary: native passes as it is, mapped is converted, decoded became PCM. */
export type FactState = "native" | "mapped" | "decoded";

export interface Fact {
  readonly text: string;
  readonly state: FactState;
}

export type DowngradeReason =
  | { readonly kind: "serverTranscode"; readonly reasons: readonly string[] }
  | { readonly kind: "outputRefuses"; readonly output: string }
  | { readonly kind: "outputUnknown"; readonly detail: string }
  | { readonly kind: "outputFailed"; readonly output: string | null }
  | { readonly kind: "rendererFailed"; readonly renderer: Renderer | "none" }
  | { readonly kind: "displaySdr" };

export interface Downgrade {
  readonly leg: "picture" | "sound";
  /** The fact at its best, e.g. "E-AC3 Atmos 5.1 bitstream". */
  readonly from: string;
  /** The fact as it plays, e.g. "E-AC3 Atmos 5.1 decoded to PCM". */
  readonly to: string;
  readonly reason: DowngradeReason;
  /** One plain sentence on what happened and why. */
  readonly message: string;
}

/** What the player saw in mpv. */
export type Observation =
  /** The audio output stopped taking what mpv sends it. */
  | { readonly kind: "audioOutputFailed" }
  /** The current renderer could not start or stopped. */
  | { readonly kind: "rendererFailed" }
  /** What the display took: HDR (PQ or HLG), or SDR. */
  | { readonly kind: "displayTarget"; readonly hdr: boolean }
  /** The owner chose another sound track, or none. */
  | { readonly kind: "soundTrack"; readonly sound: SoundSource | null };

/** What the player must change in mpv. */
export type Action =
  | { readonly kind: "setBitstream"; readonly codecs: readonly BitstreamCodec[] }
  | { readonly kind: "setRenderer"; readonly renderer: Renderer };
