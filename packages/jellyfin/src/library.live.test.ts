/// <reference types="node" />
import { QueryClient } from "@tanstack/react-query";
import { beforeAll, describe, expect, test } from "vitest";

import { corpusEntry, loadCorpus, matchCorpus } from "./contract/corpus";
import type { Corpus, CorpusMatch } from "./contract/corpus";
import { libraryItems } from "./contract/server";
import type { LibraryItem } from "./contract/server";
import { classifyFidelity } from "./fidelity";
import { DeviceId, ItemId, ServerUrl } from "./ids";
import {
  episodesQuery,
  heroQuery,
  itemQuery,
  latestQuery,
  nextUpQuery,
  publicUsersQuery,
  resumeQuery,
  seasonsQuery,
  sectionsQuery,
  serverInfoQuery,
} from "./library";
import type { LibraryContext } from "./library";
import {
  authenticate,
  createJellyfinClient,
  initiateQuickConnect,
  pollQuickConnect,
  quickConnectEnabled,
} from "./session";
import type { SessionData } from "./session";

// The dev Jellyfin from dev/jellyfin/COMMANDS.txt, or any server named by the JELLYFIN_DEV_*
// variables dev/jellyfin/client.ts reads.
const server = ServerUrl.parse(process.env.JELLYFIN_DEV_URL ?? "http://127.0.0.1:8096");
const USER = process.env.JELLYFIN_DEV_USER ?? "harakiri";
const PASSWORD = process.env.JELLYFIN_DEV_PASSWORD ?? "harakiri-dev";

const identity = {
  client: "harakiri-test",
  device: "vitest",
  deviceId: DeviceId.parse("harakiri-vitest"),
  version: "0",
};

// The live tier (`mise run test:live`): it writes to the server, so `mise run test` never runs
// it, and it fails, never skips, when the server is down.
const reachable = await fetch(new URL("System/Info/Public", server), {
  signal: AbortSignal.timeout(2000),
})
  .then((response) => response.ok)
  .catch(() => false);

if (!reachable) {
  throw new Error(
    `the Jellyfin at ${server} is unreachable: set JELLYFIN_DEV_URL (and JELLYFIN_DEV_USER, JELLYFIN_DEV_PASSWORD) to your server, or run \`mise run jellyfin:up\` for the dev container`
  );
}

const catalog = await loadCorpus();

/** Genre sections as sectionsQuery must build them from the corpus NFOs: largest first, then by name. */
const corpusSections = (present: Corpus["entries"]) => {
  const series = new Set(
    present.flatMap((entry) => (entry.kind === "episode" ? [entry.series] : []))
  );

  const genres = [
    ...present.flatMap((entry) => (entry.kind === "movie" ? entry.meta.genres : [])),
    ...[...series].flatMap((name) => catalog.series[name]?.genres ?? []),
  ];

  const counts = Map.groupBy(genres, (genre) => genre);

  return [...counts]
    .map(([genre, all]) => [genre, all.length] as const)
    .toSorted(([a, left], [b, right]) => right - left || a.localeCompare(b))
    .slice(0, 6)
    .map(([genre, count]) => [genre, Math.min(count, 20)] as const);
};

// On the generated corpus every count and pick comes from the catalog, and the server is the dev
// container bootstrap.ts built (its name, hidden user and Quick Connect). On any other server
// those expectations become the observed value, so only what holds for every library is checked:
// nothing is skipped, and the same file validates an own library through JELLYFIN_DEV_URL.
describe(`the Jellyfin at ${server}`, () => {
  let session: SessionData;
  let ctx: LibraryContext;
  let library: LibraryItem[];
  let corpus: CorpusMatch<LibraryItem> | undefined;
  beforeAll(async () => {
    const signIn = await authenticate(server, USER, PASSWORD, identity);

    if (signIn.kind !== "signed-in") {
      throw new Error(`dev sign-in failed: ${JSON.stringify(signIn)}`);
    }
    session = signIn.session;
    ctx = {
      client: createJellyfinClient(server, identity, session.accessToken),
      userId: session.userId,
    };
    library = await libraryItems(ctx);
    corpus = matchCorpus(catalog, library);
    console.info(
      `[live] ${server}: ${corpus ? `the corpus, ${corpus.present.length} of ${catalog.entries.length} entries` : `not the corpus, ${library.length} items`}`
    );
  });
  const fresh = () => new QueryClient();
  const movies = () => corpus?.present.filter((entry) => entry.kind === "movie") ?? [];

  const pick = (id: string, fallback: () => LibraryItem | undefined, what: string) => {
    if (corpus) {
      return corpus.item(corpusEntry(catalog, id));
    }
    const item = fallback();

    if (!item) {
      throw new Error(`${server} holds no ${what}`);
    }

    return item;
  };

  const rangeOf = (item: LibraryItem) =>
    item.sources[0]?.MediaStreams?.find((stream) => stream.Type === "Video")?.VideoRangeType ?? "";

  test("authenticate returns the session for the server's identity", async () => {
    const info = await fresh().fetchQuery(serverInfoQuery(server));
    expect(session).toMatchObject({
      serverUrl: server,
      serverName: info.ServerName,
      serverVersion: info.Version,
      userName: USER,
      deviceId: "harakiri-vitest",
    });
    const observed = { ServerName: info.ServerName, Version: info.Version };
    expect(observed).toEqual(corpus ? { ServerName: "harakiri-dev", Version: "12.4.0" } : observed);
  });

  test("a wrong password is wrong-credentials", async () => {
    await expect(authenticate(server, USER, "not-the-password", identity)).resolves.toEqual({
      kind: "wrong-credentials",
    });
  });

  test("publicUsersQuery: the dev server hides its only user", async () => {
    const users = await fresh().fetchQuery(publicUsersQuery(server));
    expect(users).toEqual(corpus ? [] : users);
  });

  test("Quick Connect, when enabled, issues a six-digit code that starts unapproved", async () => {
    const enabled = await quickConnectEnabled(server, identity);
    const started = enabled ? await initiateQuickConnect(server, identity) : undefined;
    const approved = started ? await pollQuickConnect(server, identity, started.secret) : false;
    expect({ enabled, code: started?.code ?? "000000", approved }).toEqual({
      enabled: corpus ? true : enabled,
      code: expect.stringMatching(/^\d{6}$/),
      approved: false,
    });
  });

  test("heroQuery: up to five films with a backdrop and a logo, HDR first", async () => {
    const films = await fresh().fetchQuery(heroQuery(ctx));
    // Every corpus film has a backdrop and a logo.
    expect(films).toHaveLength(corpus ? Math.min(5, movies().length) : Math.min(5, films.length));
    const libraryMovies = new Set(library.filter((i) => i.type === "Movie").map((i) => i.id));
    expect(films.filter((film) => !libraryMovies.has(ItemId.parse(film.Id)))).toEqual([]);

    for (const film of films) {
      expect(film.BackdropImageTags?.length).toBe(1);
      expect(film.ImageTags?.Logo).toBeTypeOf("string");
    }

    const ranges = films.map(
      (film) => classifyFidelity(film.MediaSources?.[0])?.picture.range ?? "SDR"
    );

    const firstSdr = ranges.indexOf("SDR");
    expect(
      firstSdr === -1 ? [] : ranges.slice(firstSdr).filter((range) => range !== "SDR")
    ).toEqual([]);
  });

  test("resumeQuery: every item is partly watched", async () => {
    const items = await fresh().fetchQuery(resumeQuery(ctx));
    expect(items.every((item) => (item.UserData?.PlaybackPositionTicks ?? 0) > 0)).toBe(true);
  });

  test("nextUpQuery: every item is an episode", async () => {
    const items = await fresh().fetchQuery(nextUpQuery(ctx));
    expect(items.filter((item) => item.Type !== "Episode")).toEqual([]);
  });

  test("latestQuery: films and shows, a row of at most sixteen", async () => {
    const items = await fresh().fetchQuery(latestQuery(ctx));

    const series = new Set(
      corpus?.present.flatMap((entry) => (entry.kind === "episode" ? [entry.series] : []))
    );

    const titles = new Set([...movies().map((entry) => entry.name), ...series]);
    const names = items.map((item) => item.Name ?? "");
    expect(items).toHaveLength(Math.min(16, corpus ? titles.size : items.length));
    expect(names.filter((name) => !titles.has(name))).toEqual(corpus ? [] : names);
    expect(items.filter((item) => item.Type !== "Movie" && item.Type !== "Series")).toEqual([]);
  });

  test("sectionsQuery: at most six genre sections, largest first, at most twenty items each", async () => {
    const sections = await fresh().fetchQuery(sectionsQuery(ctx));
    const shape = sections.map((section) => [section.title, section.items.length] as const);
    expect(shape).toEqual(corpus ? corpusSections(corpus.present) : shape);
    expect(sections.length).toBeLessThanOrEqual(6);

    for (const section of sections) {
      expect(section.items.length).toBeLessThanOrEqual(20);
      expect(section.items.filter((item) => !item.Genres?.includes(section.title))).toEqual([]);
    }
  });

  test("itemQuery: a Dolby Vision film with its media source and overview", async () => {
    const picked = pick(
      "dv-p8.1-hevc-mp4",
      () => library.find((i) => i.type === "Movie" && rangeOf(i).startsWith("DOVI")),
      "Dolby Vision film"
    );

    const entry = corpus ? corpusEntry(catalog, "dv-p8.1-hevc-mp4") : undefined;
    const item = await fresh().fetchQuery(itemQuery(ctx, picked.id));
    const notes = classifyFidelity(item.MediaSources?.[0])?.notes ?? "";
    expect({
      id: item.Id,
      dolbyVision: notes.includes("Dolby Vision"),
      notes,
      overview: item.Overview,
    }).toEqual({
      id: picked.id,
      dolbyVision: true,
      notes: entry ? "SD Dolby Vision · E-AC3 5.1" : notes,
      overview: entry?.kind === "movie" ? entry.meta.plot : item.Overview,
    });
  });

  test("seasonsQuery and episodesQuery: an episode's season lists it", async () => {
    const picked = pick(
      "dv-p5-hevc-episode",
      () => library.find((i) => i.type === "Episode"),
      "episode"
    );

    const episode = await fresh().fetchQuery(itemQuery(ctx, picked.id));
    const seriesId = ItemId.parse(episode.SeriesId);
    const seasons = await fresh().fetchQuery(seasonsQuery(ctx, seriesId));
    expect(seasons.map((season) => season.Id)).toContain(episode.SeasonId);

    const episodes = await fresh().fetchQuery(
      episodesQuery(ctx, seriesId, ItemId.parse(episode.SeasonId))
    );

    expect(episodes.map((item) => item.Id)).toContain(picked.id);
    const entry = corpus ? corpusEntry(catalog, "dv-p5-hevc-episode") : undefined;

    const siblings = corpus?.present.filter(
      (other) =>
        entry?.kind === "episode" &&
        other.kind === "episode" &&
        other.series === entry.series &&
        other.season === entry.season
    );

    expect(episodes).toHaveLength(siblings ? siblings.length : episodes.length);
  });
});
