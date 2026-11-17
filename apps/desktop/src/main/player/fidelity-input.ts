import type { Delivery, PictureSource, SoundCarriage, SoundSource } from "@harakiri/fidelity";
import type { PictureClass, SoundClass, SoundFormat } from "@harakiri/jellyfin";
import { classifyFidelity } from "@harakiri/jellyfin";
import type { MediaSourceInfo } from "@harakiri/jellyfin/generated";

import type { Resolution } from "./resolve";

const CARRIAGE: Readonly<Record<SoundFormat, SoundCarriage>> = {
  "TrueHD Atmos": "truehd",
  TrueHD: "truehd",
  "DTS:X": "dts-hd",
  "DTS-HD MA": "dts-hd",
  "DTS-HD HRA": "dts-hd",
  DTS: "dts",
  "E-AC3 Atmos": "eac3",
  "E-AC3": "eac3",
  AC3: "ac3",
  PCM: "pcm",
  FLAC: "decode",
  Opus: "decode",
  AAC: "decode",
  Other: "decode",
};

export const pictureSource = (picture: PictureClass): PictureSource => ({
  range: picture.range,
  label:
    picture.range === "Dolby Vision" && picture.playback === "base-layer-only"
      ? "Dolby Vision base layer"
      : picture.range,
});

export const soundSource = (sound: SoundClass): SoundSource => ({
  carriage: CARRIAGE[sound.format],
  label: sound.format === "Other" ? sound.codec.toUpperCase() : sound.format,
});

/** The file's own picture and the sound track for `audioStreamIndex`, as the server probed them. */
export const fileStreams = (source: MediaSourceInfo, audioStreamIndex: number | undefined) => {
  const fidelity = classifyFidelity(source, { audioStreamIndex });
  const sound = fidelity?.sound ?? null;

  return {
    picture: fidelity === null ? null : pictureSource(fidelity.picture),
    sound: sound === null ? null : soundSource(sound),
    /** The server's codec names, to tell a copied stream from a converted one. */
    videoCodec:
      source.MediaStreams?.find((stream) => stream.Type === "Video")?.Codec?.toLowerCase() ?? null,
    soundCodec: fidelity?.sound?.codec.toLowerCase() ?? null,
  };
};

export type FileStreams = ReturnType<typeof fileStreams>;

const TRANSCODED_SOUND = new Map<string, SoundSource>([
  ["aac", { carriage: "decode", label: "AAC" }],
  ["mp3", { carriage: "decode", label: "MP3" }],
  ["opus", { carriage: "decode", label: "Opus" }],
  ["flac", { carriage: "decode", label: "FLAC" }],
  ["ac3", { carriage: "ac3", label: "AC3" }],
  ["eac3", { carriage: "eac3", label: "E-AC3" }],
  ["truehd", { carriage: "truehd", label: "TrueHD" }],
  ["dts", { carriage: "dts", label: "DTS" }],
]);

/** The sound a transcode encodes to, from the first codec its `AudioCodec` lists. */
const encodedSound = (codec: string | undefined): SoundSource | null =>
  codec === undefined
    ? null
    : (TRANSCODED_SOUND.get(codec) ?? { carriage: "decode", label: codec.toUpperCase() });

const touchesSound = (reason: string): boolean =>
  reason.startsWith("Audio") ||
  reason === "SecondaryAudioNotSupported" ||
  reason === "UnknownAudioStreamInfo";

const touchesPicture = (reason: string): boolean =>
  !touchesSound(reason) && reason !== "SubtitleCodecNotSupported";

/**
 * What the server sends, read from the TranscodingUrl. Its `VideoCodec` and `AudioCodec` list
 * what the client accepts: Jellyfin copies a stream whose codec is listed when no transcode
 * reason touches it, and otherwise encodes to the first listed codec. An H.264 encode is SDR.
 */
export const deliveryOf = (resolution: Resolution, file: FileStreams): Delivery => {
  if (resolution.method !== "Transcode") {
    return { kind: "direct" };
  }

  const query = new URL(resolution.url).searchParams;
  const list = (name: string) => (query.get(name) ?? "").toLowerCase().split(",").filter(Boolean);

  const reasons =
    list("TranscodeReasons").length === 0 ? [] : (query.get("TranscodeReasons") ?? "").split(",");

  const videoCodecs = list("VideoCodec");
  const audioCodecs = list("AudioCodec");

  const copiesPicture =
    file.videoCodec !== null &&
    videoCodecs.includes(file.videoCodec) &&
    !reasons.some(touchesPicture);

  const copiesSound =
    file.soundCodec !== null &&
    audioCodecs.includes(file.soundCodec) &&
    !reasons.some(touchesSound);

  const [encodedVideo] = videoCodecs;
  const [encodedAudio] = audioCodecs;

  return {
    kind: "transcode",
    reasons: resolution.transcodeReasons,
    picture:
      !copiesPicture && encodedVideo === "h264" ? { range: "SDR", label: "SDR" } : file.picture,
    sound: copiesSound ? file.sound : encodedSound(encodedAudio),
  };
};
