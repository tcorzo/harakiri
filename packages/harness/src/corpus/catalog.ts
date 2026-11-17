/**
 * The synthetic Jellyfin library, declared once. Every entry says how its file is built and how
 * Jellyfin must classify it. `generate.ts` builds from this table and `classify.ts` checks a real
 * Jellyfin scan against it, so the two cannot drift.
 *
 * Titles are invented and neutral. Every file is 640x360 at 24 fps unless it comes from FATE.
 */

/** VideoRangeType as Jellyfin names it (MediaBrowser.Model/Entities/MediaStream.cs). */
export type VideoRangeType =
  | "SDR"
  | "HDR10"
  | "HLG"
  | "HDR10Plus"
  | "DOVI"
  | "DOVIWithHDR10"
  | "DOVIWithHLG"
  | "DOVIWithSDR"
  | "DOVIWithEL"
  | "DOVIWithHDR10Plus"
  | "DOVIWithELHDR10Plus"
  | "DOVIInvalid";

/** How the video stream is made. Synthetic kinds go through ffmpeg (and dovi_tool for DV). */
export type VideoRecipe =
  | { readonly kind: "sdr-h264" }
  /** One static frame for the whole runtime: long items that stay tiny. */
  | { readonly kind: "sdr-h264-still" }
  | { readonly kind: "sdr-hevc" }
  | { readonly kind: "sdr-av1" }
  | { readonly kind: "hdr10" }
  | { readonly kind: "hlg" }
  | { readonly kind: "hdr10plus" }
  | { readonly kind: "dv"; readonly profile: "5" | "8.1" | "8.4"; readonly hdr10plus: boolean }
  /** A FATE sample copied as the video stream (VC-1). */
  | { readonly kind: "fate-video"; readonly sample: FateSample }
  /** A FATE file copied whole (DV profile 7 FEL): video and whatever else it carries. */
  | { readonly kind: "fate-file"; readonly sample: FateSample };

export type AudioRecipe =
  | "aac-2.0"
  | "ac3-5.1"
  | "eac3-5.1"
  | "dts-5.1"
  | "truehd-5.1"
  | "flac-5.1"
  | "pcm-s16le-5.1"
  | "pcm-bluray-5.1"
  | "opus-2.0"
  | { readonly fate: FateSample };

export type SubtitleFormat = "srt" | "ass" | "sup";

export interface AudioTrack {
  readonly recipe: AudioRecipe;
  readonly language: string;
  readonly title?: string;
}

export interface SubtitleTrack {
  readonly format: SubtitleFormat;
  /** ISO 639-2 in the container; the sidecar file uses the matching two-letter code. */
  readonly language: "eng" | "jpn" | "fre";
}

export type Container = "mkv" | "mp4" | "m2ts" | "ts";

/** The FATE samples FFmpeg cannot encode. Pinned by sha256 in fate.ts. */
export type FateSample =
  | "atmos.thd"
  | "the_great_wall_7.1.eac3"
  | "master_audio_7.1_24bit.dts"
  | "dtsx_7.1.4_24bit.dts"
  | "SA00040.vc1"
  | "dovi-p7-hvce.mkv";

export interface ExpectedAudio {
  readonly codec: string;
  /** Jellyfin's `Profile`; null when the server reports none. */
  readonly profile: string | null;
  readonly channels: number;
}

/** What Jellyfin must report for the item's first media source. */
export interface Expected {
  readonly video: {
    readonly codec: string;
    readonly range: VideoRangeType;
    readonly dvProfile: number | null;
  };
  readonly audio: readonly ExpectedAudio[];
  readonly subtitles: { readonly embedded: number; readonly external: number };
}

export interface Metadata {
  readonly title: string;
  readonly year: number;
  readonly genres: readonly string[];
  readonly plot: string;
}

interface EntryBase {
  /** Stable id, used in logs and the manifest. */
  readonly id: string;
  /** `base` needs only ffmpeg and dovi_tool; `fate` needs the fetched FATE samples. */
  readonly tier: "base" | "fate";
  readonly seconds: number;
  readonly container: Container;
  readonly video: VideoRecipe;
  readonly audio: readonly AudioTrack[];
  readonly embeddedSubtitles: readonly SubtitleTrack[];
  readonly sidecarSubtitles: readonly SubtitleTrack[];
  readonly expect: Expected;
}

export interface MovieEntry extends EntryBase {
  readonly kind: "movie";
  readonly meta: Metadata;
}

export interface EpisodeEntry extends EntryBase {
  readonly kind: "episode";
  readonly series: SeriesName;
  readonly season: number;
  readonly episode: number;
  readonly title: string;
  readonly plot: string;
}

export type Entry = MovieEntry | EpisodeEntry;

export const SERIES = {
  "Signal Tests": {
    title: "Signal Tests",
    year: 2020,
    genres: ["Documentary", "Science Fiction"],
    plot: "A season of calibration reels, each one a different way to carry a picture.",
  },
  "Color Bars": {
    title: "Color Bars",
    year: 2016,
    genres: ["Comedy", "Animation"],
    plot: "Two short episodes about the colours a television is asked to show.",
  },
} as const satisfies Record<string, Metadata>;

export type SeriesName = keyof typeof SERIES;

/** About 6.5 minutes: inside the 6-20 min window the resume tests need (no resume under 5 min). */
export const LONG_SECONDS = 390;
const SHORT = 3;

const eng = (recipe: AudioRecipe, title?: string): AudioTrack =>
  title === undefined ? { recipe, language: "eng" } : { recipe, language: "eng", title };

const noSubs = { embeddedSubtitles: [], sidecarSubtitles: [] } as const;
const subsCount = { embedded: 0, external: 0 } as const;

const aac20: ExpectedAudio = { codec: "aac", profile: "LC", channels: 2 };
const eac351: ExpectedAudio = { codec: "eac3", profile: null, channels: 6 };
const sdr = (codec: string) => ({ codec, range: "SDR", dvProfile: null }) as const;

const hevc = (range: VideoRangeType, dvProfile: number | null = null) =>
  ({ codec: "hevc", range, dvProfile }) as const;

const movie = (
  id: string,
  meta: Metadata,
  rest: Omit<MovieEntry, "id" | "kind" | "meta" | "tier"> & { readonly tier?: "base" | "fate" }
): MovieEntry => ({ id, kind: "movie", meta, tier: rest.tier ?? "base", ...rest });

export const CATALOG: readonly Entry[] = [
  // --- SDR, long: the resume, screening and passthrough items ---
  movie(
    "sdr-h264-aac-long",
    {
      title: "Test Pattern",
      year: 2001,
      genres: ["Drama", "Documentary"],
      plot: "A still frame holds for six and a half minutes while a tone plays underneath.",
    },
    {
      seconds: LONG_SECONDS,
      container: "mkv",
      video: { kind: "sdr-h264-still" },
      audio: [eng("aac-2.0")],
      ...noSubs,
      expect: { video: sdr("h264"), audio: [aac20], subtitles: subsCount },
    }
  ),
  movie(
    "sdr-h264-eac3-long",
    {
      title: "Quiet Signal",
      year: 2003,
      genres: ["Drama", "Mystery"],
      plot: "Six channels of tone under a picture that never moves.",
    },
    {
      seconds: LONG_SECONDS,
      container: "mkv",
      video: { kind: "sdr-h264-still" },
      audio: [eng("eac3-5.1")],
      ...noSubs,
      expect: { video: sdr("h264"), audio: [eac351], subtitles: subsCount },
    }
  ),
  // --- SDR codec matrix ---
  movie(
    "sdr-h264-ac3",
    {
      title: "Copper Field",
      year: 1998,
      genres: ["Comedy", "Drama"],
      plot: "Dolby Digital 5.1 over the moving test card.",
    },
    {
      seconds: SHORT,
      container: "mkv",
      video: { kind: "sdr-h264" },
      audio: [eng("ac3-5.1")],
      ...noSubs,
      expect: {
        video: sdr("h264"),
        audio: [{ codec: "ac3", profile: null, channels: 6 }],
        subtitles: subsCount,
      },
    }
  ),
  movie(
    "sdr-hevc-dts",
    {
      title: "Static Garden",
      year: 2005,
      genres: ["Mystery", "Thriller"],
      plot: "Core DTS 5.1 on an 8-bit HEVC picture.",
    },
    {
      seconds: SHORT,
      container: "mkv",
      video: { kind: "sdr-hevc" },
      audio: [eng("dts-5.1")],
      ...noSubs,
      expect: {
        video: sdr("hevc"),
        audio: [{ codec: "dts", profile: "DTS", channels: 6 }],
        subtitles: subsCount,
      },
    }
  ),
  movie(
    "sdr-h264-truehd",
    {
      title: "Low Orbit",
      year: 2008,
      genres: ["Science Fiction"],
      plot: "Plain TrueHD 5.1, no Atmos.",
    },
    {
      seconds: SHORT,
      container: "mkv",
      video: { kind: "sdr-h264" },
      audio: [eng("truehd-5.1")],
      ...noSubs,
      expect: {
        video: sdr("h264"),
        audio: [{ codec: "truehd", profile: null, channels: 6 }],
        subtitles: subsCount,
      },
    }
  ),
  movie(
    "sdr-h264-flac",
    {
      title: "Slow River",
      year: 2010,
      genres: ["Documentary"],
      plot: "Lossless FLAC 5.1.",
    },
    {
      seconds: SHORT,
      container: "mkv",
      video: { kind: "sdr-h264" },
      audio: [eng("flac-5.1")],
      ...noSubs,
      expect: {
        video: sdr("h264"),
        audio: [{ codec: "flac", profile: null, channels: 6 }],
        subtitles: subsCount,
      },
    }
  ),
  movie(
    "sdr-h264-lpcm-mkv",
    {
      title: "Glass Archive",
      year: 2012,
      genres: ["Drama"],
      plot: "16-bit LPCM 5.1 in Matroska, which stores no channel mask.",
    },
    {
      seconds: SHORT,
      container: "mkv",
      video: { kind: "sdr-h264" },
      audio: [eng("pcm-s16le-5.1")],
      ...noSubs,
      expect: {
        video: sdr("h264"),
        audio: [{ codec: "pcm_s16le", profile: null, channels: 6 }],
        subtitles: subsCount,
      },
    }
  ),
  movie(
    "sdr-h264-lpcm-m2ts",
    {
      title: "Blue Hour",
      year: 2014,
      genres: ["Romance"],
      plot: "Blu-ray LPCM 5.1 in an M2TS transport stream.",
    },
    {
      seconds: SHORT,
      container: "m2ts",
      video: { kind: "sdr-h264" },
      audio: [eng("pcm-bluray-5.1")],
      ...noSubs,
      expect: {
        video: sdr("h264"),
        audio: [{ codec: "pcm_bluray", profile: null, channels: 6 }],
        subtitles: subsCount,
      },
    }
  ),
  // Three LPCM 5.1 tracks make about 14 Mbps from PCM alone, so the bitrate is exact and stays
  // above the 8 Mbps Jellyfin assumes when a profile sends no MaxStreamingBitrate.
  movie(
    "sdr-h264-lpcm-bitrate",
    {
      title: "Heavy Water",
      year: 2011,
      genres: ["Drama"],
      plot: "Three uncompressed 5.1 tracks: a short file with a remux's bitrate.",
    },
    {
      seconds: 2,
      container: "mkv",
      video: { kind: "sdr-h264" },
      audio: [
        { recipe: "pcm-s16le-5.1", language: "eng", title: "Main" },
        { recipe: "pcm-s16le-5.1", language: "spa", title: "Dub" },
        { recipe: "pcm-s16le-5.1", language: "fre", title: "Dub" },
      ],
      ...noSubs,
      expect: {
        video: sdr("h264"),
        audio: Array.from({ length: 3 }, () => ({
          codec: "pcm_s16le",
          profile: null,
          channels: 6,
        })),
        subtitles: subsCount,
      },
    }
  ),
  movie(
    "sdr-av1-opus",
    {
      title: "Far Meadow",
      year: 2016,
      genres: ["Animation", "Comedy"],
      plot: "AV1 picture, Opus stereo.",
    },
    {
      seconds: SHORT,
      container: "mkv",
      video: { kind: "sdr-av1" },
      audio: [eng("opus-2.0")],
      ...noSubs,
      expect: {
        video: sdr("av1"),
        audio: [{ codec: "opus", profile: null, channels: 2 }],
        subtitles: subsCount,
      },
    }
  ),
  movie(
    "sdr-h264-aac-mpegts",
    {
      title: "Open Channel",
      year: 2004,
      genres: ["Comedy"],
      plot: "A broadcast-style MPEG transport stream.",
    },
    {
      seconds: SHORT,
      container: "ts",
      video: { kind: "sdr-h264" },
      audio: [eng("aac-2.0")],
      ...noSubs,
      expect: { video: sdr("h264"), audio: [aac20], subtitles: subsCount },
    }
  ),
  movie(
    "sdr-h264-tracks",
    {
      title: "Many Voices",
      year: 2009,
      genres: ["Drama", "Comedy"],
      plot: "Two audio tracks, three embedded subtitle formats and three sidecar files.",
    },
    {
      seconds: SHORT,
      container: "mkv",
      video: { kind: "sdr-h264" },
      audio: [
        { recipe: "aac-2.0", language: "eng", title: "Stereo" },
        { recipe: "ac3-5.1", language: "spa", title: "Surround" },
      ],
      embeddedSubtitles: [
        { format: "srt", language: "eng" },
        { format: "ass", language: "jpn" },
        { format: "sup", language: "fre" },
      ],
      sidecarSubtitles: [
        { format: "srt", language: "eng" },
        { format: "ass", language: "jpn" },
        { format: "sup", language: "fre" },
      ],
      expect: {
        video: sdr("h264"),
        audio: [aac20, { codec: "ac3", profile: null, channels: 6 }],
        subtitles: { embedded: 3, external: 3 },
      },
    }
  ),
  // --- HDR ---
  movie(
    "hdr10-hevc",
    {
      title: "Lantern Hours",
      year: 2019,
      genres: ["Science Fiction", "Drama"],
      plot: "HDR10: PQ, BT.2020, mastering display and MaxCLL.",
    },
    {
      seconds: SHORT,
      container: "mkv",
      video: { kind: "hdr10" },
      audio: [eng("eac3-5.1")],
      ...noSubs,
      expect: { video: hevc("HDR10"), audio: [eac351], subtitles: subsCount },
    }
  ),
  movie(
    "hdr10-hevc-mp4",
    {
      title: "Harbour Lights",
      year: 2018,
      genres: ["Drama", "Romance"],
      plot: "The same HDR10 picture in MP4 (hvc1).",
    },
    {
      seconds: SHORT,
      container: "mp4",
      video: { kind: "hdr10" },
      audio: [eng("eac3-5.1")],
      ...noSubs,
      expect: { video: hevc("HDR10"), audio: [eac351], subtitles: subsCount },
    }
  ),
  movie(
    "hlg-hevc",
    {
      title: "Northern Glow",
      year: 2017,
      genres: ["Documentary"],
      plot: "Hybrid log-gamma, the broadcast HDR transfer.",
    },
    {
      seconds: SHORT,
      container: "mkv",
      video: { kind: "hlg" },
      audio: [eng("eac3-5.1")],
      ...noSubs,
      expect: { video: hevc("HLG"), audio: [eac351], subtitles: subsCount },
    }
  ),
  movie(
    "hdr10plus-hevc",
    {
      title: "Bright Margin",
      year: 2021,
      genres: ["Science Fiction", "Thriller"],
      plot: "HDR10+ dynamic metadata in two scenes with different peaks.",
    },
    {
      seconds: SHORT,
      container: "mkv",
      video: { kind: "hdr10plus" },
      audio: [eng("eac3-5.1")],
      ...noSubs,
      expect: { video: hevc("HDR10Plus"), audio: [eac351], subtitles: subsCount },
    }
  ),
  movie(
    "dv-p8.1-hevc-mp4",
    {
      title: "Paper Moons",
      year: 2020,
      genres: ["Drama", "Romance"],
      plot: "Dolby Vision profile 8.1 over an HDR10 base layer, in MP4.",
    },
    {
      seconds: SHORT,
      container: "mp4",
      video: { kind: "dv", profile: "8.1", hdr10plus: false },
      audio: [eng("eac3-5.1")],
      ...noSubs,
      expect: { video: hevc("DOVIWithHDR10", 8), audio: [eac351], subtitles: subsCount },
    }
  ),
  movie(
    "dv-p8.4-hevc",
    {
      title: "Hollow Tide",
      year: 2022,
      genres: ["Mystery"],
      plot: "Dolby Vision profile 8.4 over an HLG base layer.",
    },
    {
      seconds: SHORT,
      container: "mkv",
      video: { kind: "dv", profile: "8.4", hdr10plus: false },
      audio: [eng("eac3-5.1")],
      ...noSubs,
      expect: { video: hevc("DOVIWithHLG", 8), audio: [eac351], subtitles: subsCount },
    }
  ),
  movie(
    "dv-p8.1-hdr10plus-hevc",
    {
      title: "Second Light",
      year: 2023,
      genres: ["Science Fiction"],
      plot: "Dolby Vision profile 8.1 and HDR10+ on the same stream.",
    },
    {
      seconds: SHORT,
      container: "mkv",
      video: { kind: "dv", profile: "8.1", hdr10plus: true },
      audio: [eng("eac3-5.1")],
      ...noSubs,
      expect: { video: hevc("DOVIWithHDR10Plus", 8), audio: [eac351], subtitles: subsCount },
    }
  ),
  // --- Episodes ---
  {
    id: "dv-p5-hevc-episode",
    kind: "episode",
    tier: "base",
    series: "Signal Tests",
    season: 1,
    episode: 1,
    title: "Profile Five",
    plot: "Dolby Vision profile 5: no HDR10 fallback, the case that started harakiri.",
    seconds: SHORT,
    container: "mkv",
    video: { kind: "dv", profile: "5", hdr10plus: false },
    audio: [eng("eac3-5.1")],
    ...noSubs,
    expect: { video: hevc("DOVI", 5), audio: [eac351], subtitles: subsCount },
  },
  {
    id: "dv-p5-hevc-mp4-episode",
    kind: "episode",
    tier: "base",
    series: "Signal Tests",
    season: 1,
    episode: 2,
    title: "Profile Five, Boxed",
    plot: "The same profile 5 stream in MP4 (dvh1).",
    seconds: SHORT,
    container: "mp4",
    video: { kind: "dv", profile: "5", hdr10plus: false },
    audio: [eng("eac3-5.1")],
    ...noSubs,
    expect: { video: hevc("DOVI", 5), audio: [eac351], subtitles: subsCount },
  },
  {
    id: "sdr-h264-episode",
    kind: "episode",
    tier: "base",
    series: "Signal Tests",
    season: 1,
    episode: 3,
    title: "Plain Picture",
    plot: "An SDR control.",
    seconds: SHORT,
    container: "mkv",
    video: { kind: "sdr-h264" },
    audio: [eng("aac-2.0")],
    ...noSubs,
    expect: { video: sdr("h264"), audio: [aac20], subtitles: subsCount },
  },
  {
    id: "sdr-hevc-episode",
    kind: "episode",
    tier: "base",
    series: "Color Bars",
    season: 1,
    episode: 1,
    title: "Warm Up",
    plot: "SDR HEVC with stereo AAC.",
    seconds: SHORT,
    container: "mkv",
    video: { kind: "sdr-hevc" },
    audio: [eng("aac-2.0")],
    ...noSubs,
    expect: { video: sdr("hevc"), audio: [aac20], subtitles: subsCount },
  },
  {
    id: "hdr10-hevc-episode",
    kind: "episode",
    tier: "base",
    series: "Color Bars",
    season: 1,
    episode: 2,
    title: "Cool Down",
    plot: "HDR10 in an episode.",
    seconds: SHORT,
    container: "mkv",
    video: { kind: "hdr10" },
    audio: [eng("eac3-5.1")],
    ...noSubs,
    expect: { video: hevc("HDR10"), audio: [eac351], subtitles: subsCount },
  },
  // --- FATE tier: what FFmpeg cannot encode ---
  movie(
    "fate-truehd-atmos",
    {
      title: "Tall Ceiling",
      year: 2018,
      genres: ["Science Fiction", "Thriller"],
      plot: "TrueHD with Atmos, from the FFmpeg test suite.",
    },
    {
      tier: "fate",
      seconds: SHORT,
      container: "mkv",
      video: { kind: "sdr-h264" },
      audio: [eng({ fate: "atmos.thd" })],
      ...noSubs,
      expect: {
        video: sdr("h264"),
        audio: [{ codec: "truehd", profile: "Dolby TrueHD + Dolby Atmos", channels: 8 }],
        subtitles: subsCount,
      },
    }
  ),
  movie(
    "fate-eac3-joc",
    {
      title: "Wide Field",
      year: 2015,
      genres: ["Documentary"],
      plot: "E-AC3 with Atmos (JOC), from the FFmpeg test suite.",
    },
    {
      tier: "fate",
      seconds: SHORT,
      container: "mkv",
      video: { kind: "sdr-h264" },
      audio: [eng({ fate: "the_great_wall_7.1.eac3" })],
      ...noSubs,
      expect: {
        video: sdr("h264"),
        audio: [{ codec: "eac3", profile: "Dolby Digital Plus + Dolby Atmos", channels: 8 }],
        subtitles: subsCount,
      },
    }
  ),
  movie(
    "fate-dtshd-ma",
    {
      title: "Deep Archive",
      year: 2013,
      genres: ["Drama", "Mystery"],
      plot: "DTS-HD Master Audio 7.1, from the FFmpeg test suite.",
    },
    {
      tier: "fate",
      seconds: SHORT,
      container: "mkv",
      video: { kind: "sdr-h264" },
      audio: [eng({ fate: "master_audio_7.1_24bit.dts" })],
      ...noSubs,
      expect: {
        video: sdr("h264"),
        audio: [{ codec: "dts", profile: "DTS-HD MA", channels: 8 }],
        subtitles: subsCount,
      },
    }
  ),
  movie(
    "fate-dtsx",
    {
      title: "Overhead",
      year: 2024,
      genres: ["Thriller"],
      plot: "DTS:X, from the FFmpeg test suite.",
    },
    {
      tier: "fate",
      seconds: SHORT,
      container: "mkv",
      video: { kind: "sdr-h264" },
      audio: [eng({ fate: "dtsx_7.1.4_24bit.dts" })],
      ...noSubs,
      expect: {
        video: sdr("h264"),
        audio: [{ codec: "dts", profile: "DTS-HD MA + DTS:X", channels: 8 }],
        subtitles: subsCount,
      },
    }
  ),
  movie(
    "fate-vc1",
    {
      title: "Old Format",
      year: 2006,
      genres: ["Comedy"],
      plot: "VC-1 Advanced profile, from the FFmpeg test suite.",
    },
    {
      tier: "fate",
      seconds: 0.6,
      container: "mkv",
      video: { kind: "fate-video", sample: "SA00040.vc1" },
      audio: [],
      ...noSubs,
      expect: { video: sdr("vc1"), audio: [], subtitles: subsCount },
    }
  ),
  movie(
    "fate-dv-p7-fel",
    {
      title: "Twin Layer",
      year: 2019,
      genres: ["Science Fiction", "Drama"],
      plot: "Dolby Vision profile 7 with a full enhancement layer, from the FFmpeg test suite.",
    },
    {
      tier: "fate",
      seconds: 0.042,
      container: "mkv",
      video: { kind: "fate-file", sample: "dovi-p7-hvce.mkv" },
      audio: [],
      ...noSubs,
      expect: { video: hevc("DOVIWithEL", 7), audio: [], subtitles: subsCount },
    }
  ),
];

/** The folder under the corpus root, and the file name without extension. */
export const entryLocation = (entry: Entry): { dir: string; stem: string } => {
  if (entry.kind === "movie") {
    const stem = `${entry.meta.title} (${entry.meta.year})`;

    return { dir: `movies/${stem}`, stem };
  }

  const season = String(entry.season).padStart(2, "0");
  const episode = String(entry.episode).padStart(2, "0");

  return {
    dir: `shows/${entry.series}/Season ${season}`,
    stem: `${entry.series} - S${season}E${episode}`,
  };
};

export const entryPath = (entry: Entry): string => {
  const { dir, stem } = entryLocation(entry);

  return `${dir}/${stem}.${entry.container}`;
};

export const SIDECAR_LANGUAGE = { eng: "en", jpn: "ja", fre: "fr" } as const;
