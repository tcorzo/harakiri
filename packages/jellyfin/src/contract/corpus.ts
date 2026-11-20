/// <reference types="node" />
import { fileURLToPath } from "node:url";

import { z } from "zod";

const Audio = z.object({ codec: z.string(), profile: z.string().nullable(), channels: z.number() });

const Expected = z.object({
  video: z.object({ codec: z.string(), range: z.string(), dvProfile: z.number().nullable() }),
  audio: z.array(Audio),
  subtitles: z.object({ embedded: z.number(), external: z.number() }),
});

const base = {
  id: z.string(),
  tier: z.enum(["base", "fate"]),
  seconds: z.number(),
  expect: Expected,
};

const Entry = z.discriminatedUnion("kind", [
  z.object({
    ...base,
    kind: z.literal("movie"),
    meta: z.object({ title: z.string(), genres: z.array(z.string()), plot: z.string() }),
  }),
  z.object({
    ...base,
    kind: z.literal("episode"),
    series: z.string(),
    season: z.number(),
    episode: z.number(),
    plot: z.string(),
  }),
]);

const Metadata = z.object({ title: z.string(), genres: z.array(z.string()) });

// Loose: the harness catalog owns the full entry, and `entryPath` takes it as recorded there.
const RawEntry = z.looseObject({ id: z.string() });

const Catalog = z.object({
  CATALOG: z.array(RawEntry).min(1),
  SERIES: z.record(z.string(), Metadata),
  entryPath: z.custom<(entry: z.output<typeof RawEntry>) => string>(
    (value) => z.instanceof(Function).safeParse(value).success
  ),
});

export type CorpusEntry = z.output<typeof Entry> & {
  /** The file below the corpus root: `movies/<Title (Year)>/...` or `shows/<Series>/...`. */
  readonly path: string;
  /** The name contract/server.ts gives the server's item: the title, or `Series S01E02`. */
  readonly name: string;
};

export interface Corpus {
  readonly entries: readonly CorpusEntry[];
  readonly series: Readonly<Record<string, z.output<typeof Metadata>>>;
}

const pad = (n: number) => String(n).padStart(2, "0");

const tail = (entry: CorpusEntry) => `/${entry.path.split("/").slice(1).join("/")}`;

// packages/jellyfin cannot reference packages/harness in its tsconfig, so the catalog is loaded
// at run time and parsed here. It stays the one table of what the synthetic library holds.
const catalogFile = fileURLToPath(
  new URL("../../../harness/src/corpus/catalog.ts", import.meta.url)
);

export const loadCorpus = async (): Promise<Corpus> => {
  const module = Catalog.parse(await import(catalogFile));

  const entries = module.CATALOG.map((raw): CorpusEntry => {
    const entry = Entry.parse(raw);

    const name =
      entry.kind === "movie"
        ? entry.meta.title
        : `${entry.series} S${pad(entry.season)}E${pad(entry.episode)}`;

    return { ...entry, path: module.entryPath(raw), name };
  });

  return { entries, series: module.SERIES };
};

export const corpusEntry = (corpus: Corpus, id: string): CorpusEntry => {
  const entry = corpus.entries.find((candidate) => candidate.id === id);

  if (!entry) {
    throw new Error(`the corpus catalog has no entry ${id}`);
  }

  return entry;
};

export interface CorpusMatch<T> {
  /** The server's item for a catalog entry, or a loud error naming how to get it there. */
  readonly item: (entry: CorpusEntry) => T;
  /** The catalog entries the server holds. */
  readonly present: readonly CorpusEntry[];
}

/**
 * The corpus view of a server's Movies and Episodes, or undefined when the server holds anything
 * else (an own library): then only assertions that hold for any library apply. Paths match below
 * the library root, since the corpus `movies` and `shows` dirs may be mounted anywhere.
 */
export const matchCorpus = <T extends { readonly path: string }>(
  corpus: Corpus,
  items: readonly T[]
): CorpusMatch<T> | undefined => {
  const byEntry = new Map(
    corpus.entries.map((entry) => [entry, items.find((item) => item.path.endsWith(tail(entry)))])
  );

  const matched = new Set(byEntry.values());

  if (items.length === 0 || items.some((item) => !matched.has(item))) {
    return undefined;
  }

  return {
    present: corpus.entries.filter((entry) => byEntry.get(entry) !== undefined),
    item: (entry) => {
      const item = byEntry.get(entry);

      if (item !== undefined) {
        return item;
      }

      const fix =
        entry.tier === "fate"
          ? "mise run media:fetch-fate && mise run media:gen, then rescan"
          : "mise run media:gen, then rescan";

      throw new Error(`corpus entry ${entry.id} (${entry.path}) is not on the server: ${fix}`);
    },
  };
};
