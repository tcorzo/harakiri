import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";

import { match, P } from "ts-pattern";
import { z } from "zod";

import { CATALOG, entryLocation, entryPath, SERIES, SIDECAR_LANGUAGE } from "./catalog";
import type { AudioRecipe, AudioTrack, Entry, SubtitleTrack, VideoRecipe } from "./catalog";
import { fateState } from "./fate";
import type { FateState } from "./fate";
import { artworkGraph, episodeNfo, movieNfo, seriesNfo } from "./metadata";
import type { Artwork } from "./metadata";
import { writePgs } from "./pgs";
import { limiter, runAsync } from "./run";

/**
 * Writes the synthetic library into `out`, laid out as two Jellyfin libraries:
 * `movies/<Title (Year)>/` and `shows/<Series>/Season 01/`. Output is byte-identical across runs
 * on the same ffmpeg, x264, x265, SVT-AV1 and dovi_tool builds (bit-exact flags, single-threaded
 * x265, deterministic sources). Tests should still assert classification, not hashes.
 */

const FPS = 24;
const SIZE = "640x360";
const STILL_SIZE = "320x180";

// output side: no global metadata, bit-exact muxing and encoders
const OF = [
  "-map_metadata",
  "-1",
  "-map_chapters",
  "-1",
  "-fflags",
  "+bitexact",
  "-flags:v",
  "+bitexact",
  "-flags:a",
  "+bitexact",
];

const SDR_VF =
  "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv";

const PQ_VF =
  "scale=out_color_matrix=bt2020nc:out_range=tv,format=yuv420p10le,setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc:range=tv";

const HLG_VF =
  "scale=out_color_matrix=bt2020nc:out_range=tv,format=yuv420p10le,setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc:range=tv";

const P5_VF = "scale=out_range=pc,format=yuv420p10le,setparams=range=pc";
const MASTERING = "G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,50)";

// frame-threads=1:pools=1: x265 with VBV and frame threads is not bit-reproducible.
// VBV is required by libx265 for -dolbyvision.
const X265_BASE =
  "log-level=error:info=0:repeat-headers=1:vbv-maxrate=2000:vbv-bufsize=4000:frame-threads=1:pools=1";

const X265_PQ = `${X265_BASE}:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:range=limited:master-display=${MASTERING}:max-cll=1000,400:hdr10=1:hdr10-opt=1`;
const X265_HLG = `${X265_BASE}:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:range=limited:max-cll=1000,400`;
const X265_SDR = `${X265_BASE}:colorprim=bt709:transfer=bt709:colormatrix=bt709`;
const X265_P5 = `${X265_BASE}:range=full`;
const X264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-g", "24"];
const X265 = ["-c:v", "libx265", "-preset", "fast", "-crf", "30"];

const testsrc = (seconds: number) => `testsrc2=size=${SIZE}:rate=${FPS}:duration=${seconds}`;

const stereo = (seconds: number, low = 440, high = 660) =>
  `aevalsrc=exprs=0.25*sin(2*PI*${low}*t)|0.25*sin(2*PI*${high}*t):s=48000:d=${seconds}:c=stereo`;

const surround = (seconds: number) =>
  `aevalsrc=exprs=${[440, 550, 660, 55, 770, 880].map((f) => `0.2*sin(2*PI*${f}*t)`).join("|")}:s=48000:d=${seconds}:c=5.1`;

const SRT = `1
00:00:00,500 --> 00:00:01,500
First line of the SRT track.

2
00:00:02,000 --> 00:00:02,800
<i>Second</i> line.
`;

const ASS = `[Script Info]
ScriptType: v4.00+
PlayResX: 640
PlayResY: 360

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,sans-serif,28,&H0000FFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,8,10,10,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.50,0:00:02.50,Default,,0,0,0,,{\\an8}ASS styled line
`;

/** HDR10+ profile A metadata: two scenes with different peaks (hdr10plus_tool's JSON format). */
export function hdr10plusJson(frames: number): string {
  const cut = Math.floor(frames / 2);

  const frame = (i: number) => {
    const peak = i < cut ? 40_000 : 8000;

    return {
      SceneFrameIndex: i < cut ? i : i - cut,
      SceneId: i < cut ? 0 : 1,
      SequenceFrameIndex: i,
      NumberOfWindows: 1,
      TargetedSystemDisplayMaximumLuminance: 0,
      LuminanceParameters: {
        AverageRGB: Math.floor(peak / 40),
        MaxScl: [peak, peak, peak],
        LuminanceDistributions: {
          DistributionIndex: [1, 5, 10, 25, 50, 75, 90, 95, 99],
          DistributionValues: [10, 50, 100, 500, 1000, 5000, 10_000, 20_000, 40_000].map((v) =>
            Math.floor((v * peak) / 40_000)
          ),
        },
      },
    };
  };

  return JSON.stringify({
    JSONInfo: { HDR10plusProfile: "A", Version: "1.0" },
    SceneInfo: Array.from({ length: frames }, (_, i) => frame(i)),
    SceneInfoSummary: { SceneFirstFrameIndex: [0, cut], SceneFrameNumbers: [cut, frames - cut] },
    ToolInfo: { Tool: "harakiri corpus", Version: "1" },
  });
}

export interface GenerateOptions {
  readonly out: string;
  /** The directory holding the FATE samples; their tier is built only when all verify. */
  readonly fateDir: string;
  /** Throw instead of leaving the FATE tier out when the samples are not all there. */
  readonly requireFate: boolean;
  readonly log: (line: string) => void;
  readonly concurrency?: number;
}

export interface ManifestEntry {
  readonly id: string;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface Manifest {
  readonly version: 1;
  readonly fate: boolean;
  readonly entries: readonly ManifestEntry[];
  /** Entries declared in the catalog but not built, with the reason. */
  readonly skipped: readonly { readonly id: string; readonly reason: string }[];
}

export const MANIFEST = "corpus.json";

const ManifestSchema = z.object({
  version: z.literal(1),
  fate: z.boolean(),
  entries: z.array(
    z.object({ id: z.string(), path: z.string(), bytes: z.number(), sha256: z.string() })
  ),
  skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
});

export function readManifest(dir: string): Manifest {
  const file = join(dir, MANIFEST);

  if (!existsSync(file)) {
    throw new Error(`no corpus at ${dir}: run mise run media:gen`);
  }

  return ManifestSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

function describeFate(state: FateState, dir: string): string {
  return match(state)
    .with({ kind: "complete" }, () => `all FATE samples verified in ${dir}`)
    .with({ kind: "absent" }, () => `no FATE samples in ${dir}`)
    .with({ kind: "partial" }, (s) => `FATE samples missing from ${dir}: ${s.missing.join(", ")}`)
    .with(
      { kind: "corrupt" },
      (s) => `FATE samples in ${dir} fail their sha256: ${s.bad.join(", ")}`
    )
    .exhaustive();
}

/** Empties a directory but keeps it, so a running container's bind mount stays valid. */
function emptyDir(dir: string): void {
  mkdirSync(dir, { recursive: true });

  for (const name of readdirSync(dir)) {
    rmSync(join(dir, name), { recursive: true, force: true });
  }
}

const sha256File = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

export async function generateCorpus(options: GenerateOptions): Promise<Manifest> {
  const { out, fateDir, log } = options;
  const fate = fateState(fateDir);
  const withFate = fate.kind === "complete";

  if (!withFate) {
    const detail = describeFate(fate, fateDir);

    if (options.requireFate || fate.kind === "corrupt" || fate.kind === "partial") {
      throw new Error(`${detail}. Run: mise run media:fetch-fate`);
    }
    log(
      `FATE TIER NOT BUILT: ${detail}. TrueHD Atmos, E-AC3 JOC, DTS-HD MA, DTS:X, VC-1 and ` +
        `DV profile 7 items are left out. Run: mise run media:fetch-fate`
    );
  }

  const work = join(out, ".work");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  emptyDir(join(out, "movies"));
  emptyDir(join(out, "shows"));
  rmSync(join(out, MANIFEST), { force: true });

  const limit = limiter(options.concurrency ?? Math.max(2, Math.min(4, availableParallelism())));

  const ff = async (args: readonly string[]) =>
    limit(async () =>
      runAsync(
        "ffmpeg",
        ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-fflags", "+bitexact", ...args],
        { env: { ...process.env, SVT_LOG: "1" } }
      )
    );

  const tool = async (command: string, args: readonly string[]) =>
    limit(async () => runAsync(command, args));

  // Shared intermediates, built once however many entries need them.
  const memo = new Map<string, Promise<string>>();

  const once = async (key: string, build: (path: string) => Promise<unknown>): Promise<string> => {
    let promise = memo.get(key);

    if (!promise) {
      const path = join(work, key);
      promise = build(path).then(() => path);
      memo.set(key, promise);
    }

    return promise;
  };

  const rawHevc = async (key: string, vf: string, params: string, seconds: number) =>
    once(`${key}-${seconds}.hevc`, async (path) =>
      ff([
        "-f",
        "lavfi",
        "-i",
        testsrc(seconds),
        "-vf",
        vf,
        ...X265,
        "-x265-params",
        params,
        ...OF,
        "-f",
        "hevc",
        path,
      ])
    );

  // Pass 2: decode the raw HEVC and re-encode. FFmpeg hands the decoder's side data (mastering
  // display, MaxCLL, DV RPU) to libx265, which exports it as container stream side data and,
  // with -dolbyvision, the DOVI configuration record. One lavfi -> x265 pass leaves it empty.
  const reencode = async (
    raw: string,
    path: string,
    params: string,
    extra: readonly string[] = []
  ) =>
    ff([
      "-framerate",
      String(FPS),
      "-i",
      raw,
      "-map",
      "0:v",
      ...X265,
      "-x265-params",
      params,
      ...extra,
      ...OF,
      "-strict",
      "unofficial",
      path,
    ]);

  const hdr10plusFile = async (seconds: number) =>
    once(`hdr10plus-${seconds}.json`, async (path) => {
      writeFileSync(path, hdr10plusJson(seconds * FPS));
    });

  const video = async (recipe: VideoRecipe, seconds: number): Promise<string> =>
    match(recipe)
      .with({ kind: "sdr-h264" }, async () =>
        once(`sdr-h264-${seconds}.mkv`, async (path) =>
          ff(["-f", "lavfi", "-i", testsrc(seconds), "-vf", SDR_VF, ...X264, ...OF, "-an", path])
        )
      )
      .with({ kind: "sdr-h264-still" }, async () =>
        once(`sdr-h264-still-${seconds}.mkv`, async (path) =>
          ff([
            "-f",
            "lavfi",
            "-i",
            `testsrc2=size=${STILL_SIZE}:rate=${FPS}:duration=1`,
            "-vf",
            `trim=end_frame=1,loop=loop=-1:size=1,trim=duration=${seconds},setpts=N/${FPS}/TB,${SDR_VF}`,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "35",
            "-g",
            "240",
            "-tune",
            "stillimage",
            ...OF,
            "-an",
            path,
          ])
        )
      )
      .with({ kind: "sdr-hevc" }, async () =>
        once(`sdr-hevc-${seconds}.mkv`, async (path) =>
          ff([
            "-f",
            "lavfi",
            "-i",
            testsrc(seconds),
            "-vf",
            SDR_VF,
            ...X265,
            "-x265-params",
            X265_SDR,
            ...OF,
            "-an",
            path,
          ])
        )
      )
      .with({ kind: "sdr-av1" }, async () =>
        once(`sdr-av1-${seconds}.mkv`, async (path) =>
          ff([
            "-f",
            "lavfi",
            "-i",
            testsrc(seconds),
            "-vf",
            SDR_VF,
            "-c:v",
            "libsvtav1",
            "-preset",
            "10",
            "-crf",
            "45",
            "-g",
            "24",
            "-svtav1-params",
            "lp=1",
            ...OF,
            "-an",
            path,
          ])
        )
      )
      .with({ kind: "hdr10" }, async () =>
        once(`hdr10-${seconds}.mkv`, async (path) =>
          reencode(await rawHevc("pq", PQ_VF, X265_PQ, seconds), path, X265_PQ)
        )
      )
      .with({ kind: "hlg" }, async () =>
        once(`hlg-${seconds}.mkv`, async (path) =>
          reencode(await rawHevc("hlg", HLG_VF, X265_HLG, seconds), path, X265_HLG)
        )
      )
      .with({ kind: "hdr10plus" }, async () =>
        once(`hdr10plus-${seconds}.mkv`, async (path) => {
          // x265 writes the SMPTE 2094-40 SEI itself (dhdr10-info) and keeps the stream-level
          // mastering and MaxCLL side data, which hdr10plus_tool inject plus a remux loses.
          const [raw, json] = await Promise.all([
            rawHevc("pq", PQ_VF, X265_PQ, seconds),
            hdr10plusFile(seconds),
          ]);

          return reencode(raw, path, `${X265_PQ}:dhdr10-info=${json}`);
        })
      )
      .with({ kind: "dv" }, async ({ profile, hdr10plus }) =>
        once(`dv-p${profile}${hdr10plus ? "-hdr10plus" : ""}-${seconds}.mkv`, async (path) => {
          const [base, params] = match(profile)
            .with("5", () => [rawHevc("p5", P5_VF, X265_P5, seconds), X265_P5] as const)
            .with("8.1", () => [rawHevc("pq", PQ_VF, X265_PQ, seconds), X265_PQ] as const)
            .with("8.4", () => [rawHevc("hlg", HLG_VF, X265_HLG, seconds), X265_HLG] as const)
            .exhaustive();

          const config = `${path}.rpu.json`;
          writeFileSync(
            config,
            JSON.stringify({
              cm_version: "V40",
              length: seconds * FPS,
              level6: {
                max_display_mastering_luminance: 1000,
                min_display_mastering_luminance: 1,
                max_content_light_level: 1000,
                max_frame_average_light_level: 400,
              },
            })
          );
          await tool("dovi_tool", [
            "generate",
            "-j",
            config,
            "-p",
            profile,
            "-o",
            `${path}.rpu.bin`,
          ]);
          await tool("dovi_tool", [
            "inject-rpu",
            "-i",
            await base,
            "--rpu-in",
            `${path}.rpu.bin`,
            "-o",
            `${path}.hevc`,
          ]);
          const x265 = hdr10plus ? `${params}:dhdr10-info=${await hdr10plusFile(seconds)}` : params;

          return reencode(`${path}.hevc`, path, x265, ["-dolbyvision", "1"]);
        })
      )
      .with({ kind: "fate-video" }, { kind: "fate-file" }, async ({ sample }) =>
        Promise.resolve(join(fateDir, sample))
      )
      .exhaustive();

  const subtitleFile = async (format: SubtitleTrack["format"]) =>
    once(`sub.${format}`, async (path) => {
      writeFileSync(
        path,
        match(format)
          .with("srt", () => SRT)
          .with("ass", () => ASS)
          .with("sup", () =>
            writePgs(640, 360, [
              { start: 0.5, end: 1.5 },
              { start: 2, end: 2.8 },
            ])
          )
          .exhaustive()
      );
    });

  /** Input args and per-output-stream codec args for one audio track. */
  function audioArgs(track: AudioTrack, n: number, seconds: number, input: number) {
    const long = seconds > 60;
    const lavfi = (src: string) => ["-f", "lavfi", "-i", src];
    const codec = (...args: string[]) => args.map((a, i) => (i % 2 === 0 ? `${a}:a:${n}` : a));
    const recipe: AudioRecipe = track.recipe;
    const pitch = 440 + n * 110;

    const [inputs, codecArgs] = match(recipe)
      .returnType<[string[], string[]]>()
      .with("aac-2.0", () => [
        lavfi(stereo(seconds, pitch, pitch + 220)),
        codec("-c", "aac", "-b", long ? "64k" : "128k"),
      ])
      .with("opus-2.0", () => [
        lavfi(stereo(seconds, pitch, pitch + 220)),
        codec("-c", "libopus", "-b", "96k"),
      ])
      .with("ac3-5.1", () => [lavfi(surround(seconds)), codec("-c", "ac3", "-b", "384k")])
      .with("eac3-5.1", () => [
        lavfi(surround(seconds)),
        codec("-c", "eac3", "-b", long ? "96k" : "384k"),
      ])
      .with("dts-5.1", () => [lavfi(surround(seconds)), codec("-c", "dca", "-b", "768k")])
      .with("truehd-5.1", () => [lavfi(surround(seconds)), codec("-c", "truehd")])
      .with("flac-5.1", () => [lavfi(surround(seconds)), codec("-c", "flac")])
      .with("pcm-s16le-5.1", () => [lavfi(surround(seconds)), codec("-c", "pcm_s16le")])
      .with("pcm-bluray-5.1", () => [
        lavfi(surround(seconds)),
        codec("-c", "pcm_bluray", "-sample_fmt", "s16"),
      ])
      // A FATE sample can be far shorter than the item (atmos.thd holds 0.1 s), so it loops to
      // fill it and the output's -t trims; each pass starts on the sample's own sync frame.
      .with({ fate: P.string }, ({ fate: sample }) => [
        ["-stream_loop", "-1", "-i", join(fateDir, sample)],
        codec("-c", "copy"),
      ])
      .exhaustive();

    const meta = [`-metadata:s:a:${n}`, `language=${track.language}`];

    if (track.title !== undefined) {
      meta.push(`-metadata:s:a:${n}`, `title=${track.title}`);
    }

    return { inputs, map: ["-map", `${input}:a:0`], codec: [...codecArgs, ...meta] };
  }

  async function buildEntry(entry: Entry): Promise<void> {
    const { dir } = entryLocation(entry);
    mkdirSync(join(out, dir), { recursive: true });
    const dst = join(out, entryPath(entry));

    if (entry.video.kind === "fate-file") {
      copyFileSync(await video(entry.video, entry.seconds), dst);

      return;
    }

    const src = await video(entry.video, entry.seconds);
    const args: string[] = ["-i", src];
    const maps: string[] = ["-map", "0:v"];
    const codecs: string[] = ["-c:v", "copy"];
    let input = 1;
    entry.audio.forEach((track, n) => {
      const a = audioArgs(track, n, entry.seconds, input++);
      args.push(...a.inputs);
      maps.push(...a.map);
      codecs.push(...a.codec);
    });

    for (const [n, sub] of entry.embeddedSubtitles.entries()) {
      args.push("-i", await subtitleFile(sub.format));
      maps.push("-map", `${input++}:s:0`);
      codecs.push(`-metadata:s:s:${n}`, `language=${sub.language}`);
    }

    if (entry.embeddedSubtitles.length > 0) {
      codecs.push("-c:s", "copy");
    }
    const hevcTag = entry.video.kind === "dv" && entry.video.profile === "5" ? "dvh1" : "hvc1";

    const container = match(entry.container)
      .with("mkv", () => [])
      .with("mp4", () => [
        ...(entry.expect.video.codec === "hevc" ? ["-tag:v", hevcTag] : []),
        "-movflags",
        "+faststart",
      ])
      .with("m2ts", () => ["-f", "mpegts", "-mpegts_m2ts_mode", "1"])
      .with("ts", () => ["-f", "mpegts"])
      .exhaustive();

    const trim = entry.video.kind === "fate-video" ? [] : ["-t", String(entry.seconds)];
    // -strict experimental admits the experimental encoders (dca, truehd) and the unofficial
    // DOVI configuration record alike.
    await ff([
      ...args,
      ...maps,
      ...codecs,
      ...trim,
      ...container,
      ...OF,
      "-strict",
      "experimental",
      dst,
    ]);

    for (const sub of entry.sidecarSubtitles) {
      const { stem } = entryLocation(entry);
      copyFileSync(
        await subtitleFile(sub.format),
        join(out, dir, `${stem}.${SIDECAR_LANGUAGE[sub.language]}.${sub.format}`)
      );
    }
  }

  const art = async (kind: Artwork, index: number, path: string) =>
    ff(["-f", "lavfi", "-i", artworkGraph(kind, index), "-frames:v", "1", ...OF, path]);

  async function writeMetadata(entries: readonly Entry[]): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    entries.forEach((entry) => {
      const index = CATALOG.indexOf(entry);
      const { dir, stem } = entryLocation(entry);
      const at = (name: string) => join(out, dir, name);

      if (entry.kind === "movie") {
        writeFileSync(at("movie.nfo"), movieNfo(entry));

        for (const kind of ["poster", "backdrop", "logo"] as const) {
          jobs.push(art(kind, index, at(`${kind}.png`)));
        }
      } else {
        writeFileSync(at(`${stem}.nfo`), episodeNfo(entry, SERIES[entry.series].year));
        jobs.push(art("thumb", index, at(`${stem}-thumb.png`)));
      }
    });
    Object.values(SERIES).forEach((meta, i) => {
      const dir = join(out, "shows", meta.title);

      if (!existsSync(dir)) {
        return;
      }
      writeFileSync(join(dir, "tvshow.nfo"), seriesNfo(meta));

      for (const kind of ["poster", "backdrop", "logo"] as const) {
        jobs.push(art(kind, 100 + i, join(dir, `${kind}.png`)));
      }
    });
    await Promise.all(jobs);
  }

  const chosen = CATALOG.filter((entry) => entry.tier === "base" || withFate);

  const skipped = CATALOG.filter((entry) => !chosen.includes(entry)).map((entry) => ({
    id: entry.id,
    reason: describeFate(fate, fateDir),
  }));

  await Promise.all(
    chosen.map(async (entry) => {
      const t0 = performance.now();
      await buildEntry(entry);
      log(
        `${entry.id.padEnd(26)} ${((performance.now() - t0) / 1000).toFixed(2)}s  ${entryPath(entry)}`
      );
    })
  );
  await writeMetadata(chosen);
  rmSync(work, { recursive: true, force: true });

  const manifest: Manifest = {
    version: 1,
    fate: withFate,
    entries: chosen.map((entry) => {
      const path = entryPath(entry);

      return {
        id: entry.id,
        path,
        bytes: statSync(join(out, path)).size,
        sha256: sha256File(join(out, path)),
      };
    }),
    skipped,
  };

  writeFileSync(join(out, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);

  return manifest;
}

/** Bytes under `dir`, recursively. */
export function treeBytes(dir: string): number {
  let total = 0;

  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    total += name.isDirectory() ? treeBytes(path) : statSync(path).size;
  }

  return total;
}
