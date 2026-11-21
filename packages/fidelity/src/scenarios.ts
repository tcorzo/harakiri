import { fidelityView, observe, startFidelity } from "./engine";
import type { FidelityView } from "./engine";
import type {
  AudioOutput,
  Delivery,
  HdrSignalling,
  Observation,
  PictureSource,
  SoundSource,
} from "./model";

/** Sound tracks as the library has them (docs/research/07-media-census.md). */
export const soundTracks: readonly SoundSource[] = [
  { carriage: "truehd", label: "TrueHD Atmos 7.1" },
  { carriage: "dts-hd", label: "DTS:X 7.1" },
  { carriage: "dts-hd", label: "DTS-HD MA 5.1" },
  { carriage: "dts", label: "DTS 5.1" },
  { carriage: "eac3", label: "E-AC3 Atmos 5.1" },
  { carriage: "ac3", label: "AC3 5.1" },
  { carriage: "pcm", label: "PCM 2.0" },
  { carriage: "decode", label: "FLAC 2.0" },
  { carriage: "decode", label: "AAC 2.0" },
];

/** Audio outputs, and what each one does once mpv plays to it. */
export const audioOutputs: readonly {
  readonly name: string;
  readonly output: AudioOutput;
  /** What mpv reports once it plays to the output, given what harakiri sent it. */
  readonly observed: (sent: FidelityView, track: SoundSource) => readonly Observation[];
}[] = [
  {
    name: "AV receiver over HDMI, passthrough on",
    output: {
      kind: "known",
      name: "the receiver",
      bitstream: ["ac3", "eac3", "dts", "dts-hd", "truehd"],
    },
    observed: () => [],
  },
  {
    name: "TV over HDMI ARC",
    output: { kind: "known", name: "the TV", bitstream: ["ac3", "eac3"] },
    observed: () => [],
  },
  {
    name: "Older receiver (AC3 and DTS)",
    output: { kind: "known", name: "the receiver", bitstream: ["ac3", "dts"] },
    observed: () => [],
  },
  {
    name: "Analog output or headset (PCM only)",
    output: { kind: "known", name: "the headset", bitstream: [] },
    observed: () => [],
  },
  {
    name: "Output PipeWire cannot describe",
    output: { kind: "unknown", detail: "pactl failed" },
    observed: () => [],
  },
  {
    // What started harakiri: another app held the device, and a bitstream it listed went silent.
    name: "Receiver that lists every codec, then drops the bitstream",
    output: {
      kind: "known",
      name: "the receiver",
      bitstream: ["ac3", "eac3", "dts", "dts-hd", "truehd"],
    },
    observed: (sent, track) =>
      sent.bitstream.some((codec) => codec === track.carriage)
        ? [{ kind: "audioOutputFailed" }]
        : [],
  },
  {
    name: "Output disconnected during playback",
    output: { kind: "known", name: "the headset", bitstream: [] },
    observed: () => [{ kind: "audioOutputFailed" }, { kind: "audioOutputFailed" }],
  },
];

/** Pictures as the library has them. */
export const pictures: readonly PictureSource[] = [
  { range: "Dolby Vision", label: "Dolby Vision" },
  { range: "Dolby Vision", label: "Dolby Vision base layer" },
  { range: "HDR10+", label: "HDR10+" },
  { range: "HDR10", label: "HDR10" },
  { range: "HLG", label: "HLG" },
  { range: "SDR", label: "SDR" },
];

/** Display and GPU setups, as what mpv reports on each. */
export const displays: readonly {
  readonly name: string;
  /** Default "colour-management". */
  readonly hdrSignalling?: HdrSignalling;
  readonly observed: readonly Observation[];
}[] = [
  { name: "HDR display, Vulkan", observed: [{ kind: "displayTarget", hdr: true }] },
  { name: "SDR display, Vulkan", observed: [{ kind: "displayTarget", hdr: false }] },
  {
    name: "HDR display, no Vulkan driver",
    observed: [{ kind: "rendererFailed" }, { kind: "displayTarget", hdr: false }],
  },
  {
    name: "No working GPU renderer",
    observed: [{ kind: "rendererFailed" }, { kind: "rendererFailed" }, { kind: "rendererFailed" }],
  },
];

/** How the server sends the file. */
export const deliveries: readonly {
  readonly name: string;
  readonly picture: PictureSource;
  readonly sound: SoundSource;
  readonly delivery: Delivery;
}[] = [
  {
    name: "Direct play (harakiri's profile)",
    picture: { range: "Dolby Vision", label: "Dolby Vision" },
    sound: { carriage: "eac3", label: "E-AC3 Atmos 5.1" },
    delivery: { kind: "direct" },
  },
  {
    name: "Server transcode (Jellyfin Desktop's profile, the original bug)",
    picture: { range: "Dolby Vision", label: "Dolby Vision" },
    sound: { carriage: "eac3", label: "E-AC3 Atmos 5.1" },
    delivery: {
      kind: "transcode",
      reasons: ["HDR format not supported"],
      picture: { range: "SDR", label: "SDR" },
      sound: { carriage: "decode", label: "AAC 5.1" },
    },
  },
  {
    name: "Server transcode of a file it could not read",
    picture: { range: "HDR10", label: "HDR10" },
    sound: { carriage: "truehd", label: "TrueHD Atmos 7.1" },
    delivery: {
      kind: "transcode",
      reasons: ["Video stream not identified", "Audio stream not identified"],
      picture: { range: "SDR", label: "SDR" },
      sound: { carriage: "decode", label: "AAC 2.0" },
    },
  },
];

const receiver = audioOutputs[0]?.output ?? { kind: "unknown", detail: "" };
const hdrDisplay = displays[0]?.observed ?? [];

/** Plays one scenario through the engine: start, then what mpv would report. */
export const simulate = (
  picture: PictureSource | null,
  sound: SoundSource | null,
  delivery: Delivery,
  output: AudioOutput,
  observed: (sent: FidelityView) => readonly Observation[],
  hdrSignalling: HdrSignalling = "colour-management"
): FidelityView => {
  let state = startFidelity({ picture, sound, delivery, output, hdrSignalling });

  for (const observation of observed(fidelityView(state))) {
    ({ state } = observe(state, observation));
  }

  return fidelityView(state);
};

export const soundCell = (track: SoundSource, output: (typeof audioOutputs)[number]) =>
  simulate(null, track, { kind: "direct" }, output.output, (sent) => output.observed(sent, track));

export const pictureCell = (picture: PictureSource, display: (typeof displays)[number]) =>
  simulate(
    picture,
    null,
    { kind: "direct" },
    receiver,
    () => display.observed,
    display.hdrSignalling
  );

export const deliveryRow = (row: (typeof deliveries)[number]) =>
  simulate(row.picture, row.sound, row.delivery, receiver, () => hdrDisplay);
