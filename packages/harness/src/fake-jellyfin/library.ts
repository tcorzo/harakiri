import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import {
  CATALOG,
  type Entry,
  type EpisodeEntry,
  type Metadata,
  type MovieEntry,
  SERIES,
  type SeriesName,
  entryLocation,
} from "../corpus/catalog";
import { readManifest } from "../corpus/generate";
import { limiter } from "../corpus/run";
import { probeEntry, type ProbedFile } from "./probe";

/**
 * The fake's library, built once per server from the corpus catalog and its `corpus.json`
 * manifest: the catalog says what each file is, the manifest which files exist. Ids are
 * deterministic, so the same entry has the same id in every run.
 */

export type ImageType = (typeof IMAGE_TYPES)[number];

export interface Image {
  readonly file: string;
  readonly tag: string;
}

interface Base {
  readonly id: string;
  readonly name: string;
  readonly images: Partial<Record<ImageType, Image>>;
  /** Jellyfin's DateCreated, which orders Recently Added. */
  readonly dateCreated: string;
  /** DateCreated in nanoseconds, to sort by. */
  readonly createdNs: bigint;
  readonly sortName: string;
}

export interface VideoItem extends Base {
  readonly type: "Movie" | "Episode";
  readonly entry: Entry;
  readonly file: string;
  /** The path a real server reports: the dev container mounts the corpus at /media. */
  readonly path: string;
  /** The media source's Container. */
  readonly container: string;
  /** The item's Container: ffprobe's format list as Jellyfin normalises it. */
  readonly formats: string;
  readonly size: number;
  readonly etag: string;
  readonly probed: ProbedFile;
  readonly year: number;
  readonly overview: string;
  readonly genres: readonly string[];
}

export interface MovieItem extends VideoItem {
  readonly type: "Movie";
  readonly entry: MovieEntry;
}

export interface EpisodeItem extends VideoItem {
  readonly type: "Episode";
  readonly entry: EpisodeEntry;
  readonly seriesId: string;
  readonly seasonId: string;
}

export interface SeriesItem extends Base {
  readonly type: "Series";
  readonly meta: Metadata;
  readonly path: string;
  readonly seasonIds: readonly string[];
}

export interface SeasonItem extends Base {
  readonly type: "Season";
  readonly seriesId: string;
  readonly index: number;
  readonly path: string;
  readonly episodeIds: readonly string[];
}

export interface FolderItem extends Base {
  readonly type: "CollectionFolder";
  readonly collectionType: "movies" | "tvshows";
}

export type Item = MovieItem | EpisodeItem | SeriesItem | SeasonItem | FolderItem;

export interface Library {
  readonly items: ReadonlyMap<string, Item>;
  /** Catalog entry id to item id, for tests that name an entry. */
  readonly byEntry: ReadonlyMap<string, string>;
  readonly views: readonly FolderItem[];
  /** Whether the FATE tier was built into the corpus. */
  readonly fate: boolean;
}

/** A 32-hex id from a stable key, like Jellyfin's path-derived Guids. */
export const fakeId = (key: string) =>
  createHash("md5").update(`harakiri-fake:${key}`).digest("hex");

const fileTag = (file: string) => createHash("md5").update(readFileSync(file)).digest("hex");

export const IMAGE_TYPES = ["Primary", "Backdrop", "Logo", "Thumb"] as const;

function images(files: Partial<Record<ImageType, string>>): Partial<Record<ImageType, Image>> {
  const out: Partial<Record<ImageType, Image>> = {};
  for (const type of IMAGE_TYPES) {
    const file = files[type];
    if (file !== undefined && existsSync(file)) out[type] = { file, tag: fileTag(file) };
  }
  return out;
}

const isType = <T extends Item["type"]>(
  item: Item | undefined,
  type: T,
): item is Extract<Item, { readonly type: T }> => item?.type === type;

/** The item with this id, which must be of this type: the library is built consistent. */
export function itemOf<T extends Item["type"]>(
  items: ReadonlyMap<string, Item>,
  id: string,
  type: T,
): Extract<Item, { readonly type: T }> {
  const found = items.get(id);
  if (!isType(found, type)) throw new Error(`The fake library has no ${type} ${id}`);
  return found;
}

// A media source's Container, as a real 12.4 scan of the corpus reports it.
const CONTAINER: Readonly<Record<Entry["container"], string>> = {
  mkv: "mkv",
  mp4: "mp4",
  m2ts: "ts",
  ts: "ts",
};

const WEBM_CODECS = {
  Video: ["vp8", "vp9", "av1"],
  Audio: ["opus", "vorbis"],
  Subtitle: ["webvtt"],
};

/** The item's Container: Matroska is "mkv,webm" only when every stream also fits WebM. */
function formats(entry: Entry, probed: ProbedFile): string {
  if (entry.container === "mp4") return "mov,mp4,m4a,3gp,3g2,mj2";
  if (entry.container !== "mkv") return "ts";
  const webm = probed.streams
    .filter((s) => !s.IsExternal)
    .every((s) => WEBM_CODECS[s.Type].includes(s.Codec.toLowerCase()));
  return webm ? "mkv,webm" : "mkv";
}

const sortName = (name: string) => name.toLowerCase().replace(/^(the|a|an) /, "");

/** A .NET round-trip date with trailing zeros dropped, as Jellyfin serialises DateCreated. */
function dotnetDate(ns: bigint): string {
  const seconds = new Date(Number(ns / 1_000_000_000n) * 1000).toISOString().slice(0, 19);
  const fraction = String((ns % 1_000_000_000n) / 100n)
    .padStart(7, "0")
    .replace(/0+$/, "");
  return `${seconds}${fraction === "" ? "" : `.${fraction}`}Z`;
}

// A file's DateCreated is its modification time; folders get the scan time, after every file.
const modified = (file: string) => statSync(file, { bigint: true }).mtimeNs;

export async function loadLibrary(corpusDir: string): Promise<Library> {
  const manifest = readManifest(corpusDir);
  const built = new Map(manifest.entries.map((m) => [m.id, m]));
  const containerPath = (file: string) =>
    file
      .replace(join(corpusDir, "movies"), "/media/movies")
      .replace(join(corpusDir, "shows"), "/media/series");
  const items = new Map<string, Item>();
  const byEntry = new Map<string, string>();
  const run = limiter(8);

  const entries = CATALOG.filter((entry) => built.has(entry.id));
  const probed = await Promise.all(
    entries.map((entry) => {
      const file = join(corpusDir, built.get(entry.id)?.path ?? "");
      return run(async () => ({
        entry,
        file,
        probed: await probeEntry(entry, file, containerPath),
      }));
    }),
  );

  const seriesIds = new Map<SeriesName, string>();
  const seasonEpisodes = new Map<string, string[]>();
  probed.forEach(({ entry, file, probed: p }) => {
    const id = fakeId(entry.id);
    byEntry.set(entry.id, id);
    const { dir, stem } = entryLocation(entry);
    const at = (name: string) => join(corpusDir, dir, name);
    const video = {
      id,
      entry,
      file,
      path: containerPath(file),
      container: CONTAINER[entry.container],
      formats: formats(entry, p),
      size: statSync(file).size,
      etag: createHash("md5")
        .update(`${id}:${statSync(file).size}`)
        .digest("hex"),
      probed: p,
      dateCreated: dotnetDate(modified(file)),
      createdNs: modified(file),
    };
    if (entry.kind === "movie") {
      items.set(id, {
        ...video,
        type: "Movie",
        entry,
        name: entry.meta.title,
        sortName: sortName(entry.meta.title),
        year: entry.meta.year,
        overview: entry.meta.plot,
        genres: entry.meta.genres,
        images: images({
          Primary: at("poster.png"),
          Backdrop: at("backdrop.png"),
          Logo: at("logo.png"),
        }),
      });
      return;
    }
    const seriesId = seriesIds.get(entry.series) ?? fakeId(`series:${entry.series}`);
    seriesIds.set(entry.series, seriesId);
    const seasonId = fakeId(`season:${entry.series}:${entry.season}`);
    seasonEpisodes.set(seasonId, [...(seasonEpisodes.get(seasonId) ?? []), id]);
    items.set(id, {
      ...video,
      type: "Episode",
      entry,
      seriesId,
      seasonId,
      name: entry.title,
      sortName: sortName(entry.title),
      year: SERIES[entry.series].year,
      overview: entry.plot,
      genres: [],
      images: images({ Primary: at(`${stem}-thumb.png`) }),
    });
  });

  const newest = probed.reduce(
    (max, { file }) => (modified(file) > max ? modified(file) : max),
    0n,
  );
  let order = 0n;
  const scanned = () => {
    const ns = newest + 60_000_000_000n + order++ * 1_000_000n;
    return { dateCreated: dotnetDate(ns), createdNs: ns };
  };
  for (const [series, seriesId] of seriesIds) {
    const meta = SERIES[series];
    const dir = join(corpusDir, "shows", meta.title);
    const seasons = [...seasonEpisodes].filter(
      ([, episodes]) => itemOf(items, episodes[0] ?? "", "Episode").seriesId === seriesId,
    );
    for (const [seasonId, episodeIds] of seasons) {
      const first = itemOf(items, episodeIds[0] ?? "", "Episode");
      const index = first.entry.season;
      const sorted = episodeIds.toSorted(
        (a, b) =>
          itemOf(items, a, "Episode").entry.episode - itemOf(items, b, "Episode").entry.episode,
      );
      items.set(seasonId, {
        id: seasonId,
        type: "Season",
        name: `Season ${index}`,
        sortName: `season ${String(index).padStart(3, "0")}`,
        seriesId,
        index,
        path: containerPath(join(dir, `Season ${String(index).padStart(2, "0")}`)),
        episodeIds: sorted,
        images: {},
        ...scanned(),
      });
    }
    items.set(seriesId, {
      id: seriesId,
      type: "Series",
      name: meta.title,
      sortName: sortName(meta.title),
      meta,
      path: containerPath(dir),
      seasonIds: seasons.map(([id]) => id),
      images: images({
        Primary: join(dir, "poster.png"),
        Backdrop: join(dir, "backdrop.png"),
        Logo: join(dir, "logo.png"),
      }),
      ...scanned(),
    });
  }

  const views: FolderItem[] = (
    [
      ["Movies", "movies"],
      ["Shows", "tvshows"],
    ] as const
  ).map(([name, collectionType]) => ({
    id: fakeId(`view:${collectionType}`),
    type: "CollectionFolder",
    name,
    sortName: name.toLowerCase(),
    collectionType,
    images: {},
    ...scanned(),
  }));
  for (const view of views) items.set(view.id, view);

  return { items, byEntry, views, fate: manifest.fate };
}

export const isVideo = (item: Item): item is MovieItem | EpisodeItem =>
  item.type === "Movie" || item.type === "Episode";

export const fileName = (item: VideoItem) => basename(item.file).replace(/\.[^.]+$/, "");
