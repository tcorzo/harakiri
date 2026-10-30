import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { match } from "ts-pattern";
import { z } from "zod";
import type { Entry, ExpectedAudio } from "../corpus/catalog";
import { runAsync } from "../corpus/run";

/**
 * Turns a corpus file into the MediaStreams Jellyfin 12.4 reports for it. The catalog's `expect`
 * (checked against a real scan by `classify.ts`) supplies what Jellyfin derives itself: the range
 * type, the audio Profile and channel count. ffprobe supplies the rest, as Jellyfin's own probe
 * does. Shapes follow the recorded PlaybackInfo fixtures in apps/desktop/src/main/player/fixtures.
 */

const ProbeStream = z.object({
  index: z.number().int(),
  codec_name: z.string().optional(),
  codec_type: z.string(),
  profile: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  display_aspect_ratio: z.string().optional(),
  pix_fmt: z.string().optional(),
  level: z.number().optional(),
  color_range: z.string().optional(),
  color_space: z.string().optional(),
  color_transfer: z.string().optional(),
  color_primaries: z.string().optional(),
  r_frame_rate: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  time_base: z.string().optional(),
  bit_rate: z.string().optional(),
  bits_per_raw_sample: z.string().optional(),
  sample_rate: z.string().optional(),
  channels: z.number().optional(),
  channel_layout: z.string().optional(),
  disposition: z.record(z.string(), z.number()).default({}),
  tags: z.record(z.string(), z.string()).default({}),
  side_data_list: z.array(z.record(z.string(), z.unknown())).default([]),
});
type ProbeStream = z.infer<typeof ProbeStream>;

const Probe = z.object({
  streams: z.array(ProbeStream),
  format: z.object({ duration: z.string().optional(), bit_rate: z.string().optional() }),
});
type Probe = z.infer<typeof Probe>;

export async function ffprobe(path: string): Promise<Probe> {
  const { stdout } = await runAsync("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    path,
  ]);
  return Probe.parse(JSON.parse(stdout));
}

/** A MediaStream as Jellyfin serialises it: PascalCase keys, absent rather than null. */
export type MediaStream = Record<string, unknown> & {
  readonly Type: "Video" | "Audio" | "Subtitle";
  readonly Index: number;
  readonly Codec: string;
  readonly IsExternal: boolean;
};

export interface ProbedFile {
  readonly streams: readonly MediaStream[];
  /** The sidecar subtitle files, by Jellyfin stream index. */
  readonly sidecars: ReadonlyMap<number, string>;
  readonly runTimeTicks: number;
  readonly bitrate: number | undefined;
}

const LANGUAGES: Readonly<Record<string, { readonly name: string; readonly two: string }>> = {
  eng: { name: "English", two: "en" },
  jpn: { name: "Japanese", two: "ja" },
  fra: { name: "French", two: "fr" },
  spa: { name: "Spanish", two: "es" },
};

// Jellyfin 12 stores ISO 639-2/T codes: a file tagged "fre" reports "fra".
const BIBLIOGRAPHIC: Readonly<Record<string, string>> = {
  alb: "sqi",
  arm: "hye",
  baq: "eus",
  bur: "mya",
  chi: "zho",
  cze: "ces",
  dut: "nld",
  fre: "fra",
  geo: "kat",
  ger: "deu",
  gre: "ell",
  ice: "isl",
  mac: "mkd",
  mao: "mri",
  may: "msa",
  per: "fas",
  rum: "ron",
  slo: "slk",
  tib: "bod",
  wel: "cym",
};
const terminology = (code: string) => BIBLIOGRAPHIC[code] ?? code;
/** The language a display title names; "und" is stored but names nothing. */
const named = (code: string | undefined) => (code === "und" ? undefined : code);
const fromTwoLetter = (two: string) =>
  Object.entries(LANGUAGES).find(([, l]) => l.two === two)?.[0] ?? two;

const SUBTITLE_CODEC: Readonly<Record<string, string>> = {
  hdmv_pgs_subtitle: "PGSSUB",
  dvd_subtitle: "DVDSUB",
};
const SIDECAR_CODEC: Readonly<Record<string, string>> = {
  srt: "subrip",
  ass: "ass",
  sup: "PGSSUB",
};

const num = (value: string | undefined): number | undefined => {
  if (value === undefined || value === "N/A") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const rate = (value: string | undefined): number | undefined => {
  const [n, d] = (value ?? "").split("/").map(Number);
  if (n === undefined || d === undefined || !d) return undefined;
  return Math.round((n / d) * 1e6) / 1e6;
};

/**
 * Jellyfin keeps ffprobe's layout name without the "(side)" variant, and none for an unknown
 * mask (PCM in Matroska), where the display title falls back to "6 ch".
 */
function channelLayout(stream: ProbeStream): string | undefined {
  const raw = stream.channel_layout;
  return raw === undefined || raw === "unknown" ? undefined : raw.replace(/\(side\)$/, "");
}

const firstUpper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** MediaStream.DisplayTitle from Jellyfin's MediaBrowser.Model/Entities/MediaStream.cs. */
function withTitle(
  title: string | undefined,
  attributes: readonly string[],
  separator: string,
): string {
  if (title === undefined) return attributes.join(separator);
  return [
    title,
    ...attributes.filter((tag) => !title.toLowerCase().includes(tag.toLowerCase())),
  ].join(" - ");
}

function resolutionText(width: number, height: number): string | undefined {
  const table: readonly [number, number, string][] = [
    [256, 144, "144p"],
    [426, 240, "240p"],
    [640, 360, "360p"],
    [682, 384, "384p"],
    [720, 404, "404p"],
    [854, 480, "480p"],
    [960, 544, "540p"],
    [1024, 576, "576p"],
    [1280, 962, "720p"],
    [2560, 1440, "1080p"],
    [4096, 3072, "4K"],
    [8192, 6144, "8K"],
  ];
  return table.find(([w, h]) => width <= w && height <= h)?.[2];
}

const AUDIO_NAME: Readonly<Record<string, string>> = {
  ac3: "Dolby Digital",
  eac3: "Dolby Digital+",
  dca: "DTS",
};

function doviTitle(profile: number, compat: number): string {
  const suffix = match(compat)
    .with(1, () => " (HDR10)")
    .with(2, () => " (SDR)")
    .with(4, () => " (HLG)")
    .with(6, () => " (HDR10)")
    .otherwise(() => "");
  const level = profile === 5 ? "" : `.${compat}`;
  return `Dolby Vision Profile ${profile}${level}${suffix}`;
}

const common = {
  AudioSpatialFormat: "None",
  IsInterlaced: false,
  IsForced: false,
  IsHearingImpaired: false,
  IsOriginal: false,
} as const;

function language(stream: ProbeStream): string | undefined {
  const lang = stream.tags["language"];
  return lang === undefined ? undefined : terminology(lang);
}

function videoStream(entry: Entry, s: ProbeStream, index: number, fallbackBitrate?: number) {
  const width = s.width ?? 0;
  const height = s.height ?? 0;
  const range = entry.expect.video.range;
  const dovi = s.side_data_list.find((d) => d["side_data_type"] === "DOVI configuration record");
  const dvNumber = (key: string) => (typeof dovi?.[key] === "number" ? dovi[key] : undefined);
  const dvProfile = dvNumber("dv_profile");
  const compat = dvNumber("dv_bl_signal_compatibility_id") ?? 0;
  const doviTitleText =
    dovi !== undefined && dvProfile !== undefined && range.startsWith("DOVI")
      ? doviTitle(dvProfile, compat)
      : undefined;
  const videoRange = range === "SDR" ? "SDR" : "HDR";
  const codec = s.codec_name ?? "";
  const title = s.tags["title"];
  const frameRate = rate(s.avg_frame_rate);
  const bitDepth = num(s.bits_per_raw_sample) ?? (s.pix_fmt?.includes("10") === true ? 10 : 8);
  return {
    Codec: codec,
    ...(language(s) === undefined ? {} : { Language: language(s) }),
    ...(s.color_space === undefined || s.color_space === "unknown"
      ? {}
      : { ColorSpace: s.color_space }),
    ...(s.color_transfer === undefined || s.color_transfer === "unknown"
      ? {}
      : { ColorTransfer: s.color_transfer }),
    ...(s.color_primaries === undefined || s.color_primaries === "unknown"
      ? {}
      : { ColorPrimaries: s.color_primaries }),
    ...(dovi === undefined
      ? {}
      : {
          DvVersionMajor: dvNumber("dv_version_major"),
          DvVersionMinor: dvNumber("dv_version_minor"),
          DvProfile: dvProfile,
          DvLevel: dvNumber("dv_level"),
          RpuPresentFlag: dvNumber("rpu_present_flag"),
          ElPresentFlag: dvNumber("el_present_flag"),
          BlPresentFlag: dvNumber("bl_present_flag"),
          DvBlSignalCompatibilityId: compat,
        }),
    ...(range.includes("HDR10Plus") ? { Hdr10PlusPresentFlag: true } : {}),
    ...(s.time_base === undefined ? {} : { TimeBase: s.time_base }),
    ...(title === undefined ? {} : { Title: title }),
    ...(doviTitleText === undefined ? {} : { VideoDoViTitle: doviTitleText }),
    VideoRange: videoRange,
    VideoRangeType: range,
    ...common,
    DisplayTitle: withTitle(
      title,
      [resolutionText(width, height), codec.toUpperCase(), doviTitleText ?? videoRange].filter(
        (part): part is string => part !== undefined,
      ),
      " ",
    ),
    ...(() => {
      const bitRate = num(s.bit_rate) ?? num(s.tags["BPS"]) ?? fallbackBitrate;
      return bitRate === undefined ? {} : { BitRate: bitRate };
    })(),
    BitDepth: bitDepth,
    RefFrames: 1,
    IsDefault: s.disposition["default"] === 1,
    Height: height,
    Width: width,
    ...(frameRate === undefined
      ? {}
      : {
          AverageFrameRate: frameRate,
          RealFrameRate: rate(s.r_frame_rate) ?? frameRate,
          ReferenceFrameRate: rate(s.r_frame_rate) ?? frameRate,
        }),
    ...(s.profile === undefined ? {} : { Profile: s.profile }),
    Type: "Video" as const,
    ...(s.display_aspect_ratio === undefined ? {} : { AspectRatio: s.display_aspect_ratio }),
    Index: index,
    IsExternal: false,
    IsTextSubtitleStream: false,
    SupportsExternalStream: false,
    ...(s.pix_fmt === undefined ? {} : { PixelFormat: s.pix_fmt }),
    ...(s.level === undefined ? {} : { Level: s.level }),
    IsAnamorphic: false,
  };
}

function audioStream(s: ProbeStream, index: number, expected: ExpectedAudio | undefined) {
  const codec = expected?.codec ?? s.codec_name ?? "";
  const channels = expected?.channels ?? s.channels ?? 0;
  const layout = channelLayout(s);
  const code = language(s);
  const lang = named(code);
  const title = s.tags["title"];
  const profile = expected?.profile ?? undefined;
  const isDefault = s.disposition["default"] === 1;
  const attributes = [
    ...(lang === undefined ? [] : [LANGUAGES[lang]?.name ?? firstUpper(lang)]),
    profile !== undefined && profile.toLowerCase() !== "lc"
      ? profile
      : (AUDIO_NAME[codec] ?? codec.toUpperCase()),
    ...(layout === undefined ? [`${channels} ch`] : [firstUpper(layout)]),
    ...(isDefault ? ["Default"] : []),
  ];
  const bitRate = num(s.bit_rate) ?? num(s.tags["BPS"]);
  const bitDepth = num(s.bits_per_raw_sample);
  return {
    Codec: codec,
    ...(code === undefined ? {} : { Language: code }),
    ...(s.time_base === undefined ? {} : { TimeBase: s.time_base }),
    ...(title === undefined ? {} : { Title: title }),
    VideoRange: "Unknown",
    VideoRangeType: "Unknown",
    ...common,
    AudioSpatialFormat:
      profile?.includes("Atmos") === true
        ? "DolbyAtmos"
        : profile?.includes("DTS:X") === true
          ? "DTSX"
          : "None",
    LocalizedDefault: "Default",
    LocalizedExternal: "External",
    LocalizedOriginal: "Original",
    DisplayTitle: withTitle(title, attributes, " - "),
    ...(layout === undefined ? {} : { ChannelLayout: layout }),
    ...(bitRate === undefined ? {} : { BitRate: bitRate }),
    ...(bitDepth === undefined ? {} : { BitDepth: bitDepth }),
    Channels: channels,
    ...(num(s.sample_rate) === undefined ? {} : { SampleRate: num(s.sample_rate) }),
    IsDefault: isDefault,
    ...(profile === undefined ? {} : { Profile: profile }),
    Type: "Audio" as const,
    Index: index,
    IsExternal: false,
    IsTextSubtitleStream: false,
    SupportsExternalStream: false,
  };
}

function subtitleStream(input: {
  readonly codec: string;
  readonly language: string | undefined;
  readonly title: string | undefined;
  readonly isDefault: boolean;
  readonly index: number;
  readonly external: string | undefined;
  readonly timeBase: string | undefined;
  readonly size: { width: number; height: number } | undefined;
}) {
  const { codec, language: code, title, isDefault, index, external } = input;
  const lang = named(code);
  const text = codec !== "PGSSUB" && codec !== "DVDSUB";
  const attributes = [
    lang === undefined ? "Undefined" : (LANGUAGES[lang]?.name ?? firstUpper(lang)),
    ...(isDefault ? ["Default"] : []),
    codec.toUpperCase(),
    ...(external === undefined ? [] : ["External"]),
  ];
  return {
    Codec: codec,
    ...(code === undefined ? {} : { Language: code }),
    ...(input.timeBase === undefined ? {} : { TimeBase: input.timeBase }),
    ...(title === undefined ? {} : { Title: title }),
    VideoRange: "Unknown",
    VideoRangeType: "Unknown",
    ...common,
    LocalizedUndefined: "Undefined",
    LocalizedDefault: "Default",
    LocalizedForced: "Forced",
    LocalizedExternal: "External",
    LocalizedHearingImpaired: "Hearing Impaired",
    ...(lang === undefined ? {} : { LocalizedLanguage: LANGUAGES[lang]?.name ?? lang }),
    DisplayTitle: withTitle(title, attributes, " - "),
    IsDefault: isDefault,
    ...(input.size === undefined ? {} : { Height: input.size.height, Width: input.size.width }),
    Type: "Subtitle" as const,
    Index: index,
    IsExternal: external !== undefined,
    IsTextSubtitleStream: text,
    SupportsExternalStream: true,
    ...(external === undefined ? {} : { Path: external }),
  };
}

/** The sidecar subtitle files next to a media file, as Jellyfin's external subtitle provider finds them. */
function sidecarsOf(mediaPath: string): { file: string; language: string; ext: string }[] {
  const stem = basename(mediaPath).replace(/\.[^.]+$/, "");
  const dir = dirname(mediaPath);
  return readdirSync(dir)
    .filter((name) => name.startsWith(`${stem}.`) && name !== basename(mediaPath))
    .flatMap((name) => {
      const parts = name.slice(stem.length + 1).split(".");
      const ext = parts.at(-1) ?? "";
      if (SIDECAR_CODEC[ext] === undefined) return [];
      return [{ file: join(dir, name), language: fromTwoLetter(parts[0] ?? ""), ext }];
    })
    .toSorted((a, b) => a.file.localeCompare(b.file));
}

/**
 * Probes one corpus file. `containerPath` maps a corpus path to the path the server reports
 * (`/media/movies/...` in the dev container), so sidecars carry the same Path a real scan does.
 */
export async function probeEntry(
  entry: Entry,
  file: string,
  containerPath: (file: string) => string,
): Promise<ProbedFile> {
  const probe = await ffprobe(file);
  const external = sidecarsOf(file);
  // Jellyfin numbers external subtitles first, then the container's streams after them.
  const offset = external.length;
  const sidecars = new Map<number, string>();
  const externalStreams = await Promise.all(
    external.map(async (sidecar, i) => {
      sidecars.set(i, sidecar.file);
      const codec = SIDECAR_CODEC[sidecar.ext] ?? sidecar.ext;
      const size =
        codec === "PGSSUB"
          ? await ffprobe(sidecar.file).then(({ streams: [s] }) =>
              s?.width === undefined || s.height === undefined
                ? undefined
                : { width: s.width, height: s.height },
            )
          : undefined;
      return subtitleStream({
        codec,
        language: sidecar.language,
        title: undefined,
        isDefault: false,
        index: i,
        external: containerPath(sidecar.file),
        timeBase: undefined,
        size,
      });
    }),
  );
  const formatBitrate = num(probe.format.bit_rate);
  const audioBitrates = probe.streams
    .filter((s) => s.codec_type === "audio")
    .reduce((sum, s) => sum + (num(s.bit_rate) ?? 0), 0);
  let audioSeen = 0;
  const inner = probe.streams.flatMap((s): MediaStream[] =>
    match(s.codec_type)
      .with("video", () => [
        videoStream(
          entry,
          s,
          offset + s.index,
          formatBitrate === undefined ? undefined : formatBitrate - audioBitrates,
        ),
      ])
      .with("audio", () => [audioStream(s, offset + s.index, entry.expect.audio[audioSeen++])])
      .with("subtitle", () => [
        subtitleStream({
          codec: SUBTITLE_CODEC[s.codec_name ?? ""] ?? s.codec_name ?? "",
          language: language(s),
          title: s.tags["title"],
          isDefault: s.disposition["default"] === 1,
          index: offset + s.index,
          external: undefined,
          timeBase: s.time_base,
          size:
            s.width === undefined || s.height === undefined
              ? undefined
              : { width: s.width, height: s.height },
        }),
      ])
      .otherwise(() => []),
  );
  const seconds = num(probe.format.duration) ?? entry.seconds;
  return {
    streams: [...externalStreams, ...inner],
    sidecars,
    runTimeTicks: Math.round(seconds * 1e7),
    bitrate: formatBitrate,
  };
}
