import { QueryClient } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";

import { AccessToken, DeviceId, ItemId, ServerUrl, UserId } from "./ids";
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
import { createJellyfinClient } from "./session";

const USER = "5f2a9c1e0b7d4e3fa8c6d1b2e9f04a7c";
const server = ServerUrl.parse("http://jf.test");

const identity = {
  client: "Harakiri",
  device: "TV",
  deviceId: DeviceId.parse("dev-1"),
  version: "0.1.0",
};

const ctx = {
  client: createJellyfinClient(server, identity, AccessToken.parse("tok")),
  userId: UserId.parse(USER),
};

const SERIES = ItemId.parse("0123456789abcdef0123456789abcdef");
const SEASON = ItemId.parse("fedcba9876543210fedcba9876543210");

const received: { url: string; auth: string | null }[] = [];

const hdr = {
  MediaStreams: [{ Type: "Video", Width: 3840, VideoRange: "HDR", VideoRangeType: "HDR10" }],
};

const sdr = {
  MediaStreams: [{ Type: "Video", Width: 1920, VideoRange: "SDR", VideoRangeType: "SDR" }],
};

let itemsBody: { Items: Record<string, unknown>[] } = { Items: [] };

const mock = setupServer(
  http.get("http://jf.test/*", ({ request }) => {
    const url = new URL(request.url);
    received.push({
      url: `${url.pathname}${url.search}`,
      auth: request.headers.get("Authorization"),
    });

    if (url.pathname === "/Items") {
      return HttpResponse.json(itemsBody);
    }

    if (url.pathname === "/Items/Latest" || url.pathname === "/Users/Public") {
      return HttpResponse.json([]);
    }

    if (url.pathname === "/System/Info/Public") {
      return HttpResponse.json({ ServerName: "jf", Version: "12.4.0" });
    }

    if (url.pathname.startsWith("/Items/")) {
      return HttpResponse.json({ Id: SERIES, Name: "Fixture Film" });
    }

    return HttpResponse.json({ Items: [] });
  })
);

beforeAll(() => mock.listen({ onUnhandledFrame: "error" }));

afterEach(() => {
  received.length = 0;
  itemsBody = { Items: [] };
});

afterAll(() => mock.close());

const fresh = () => new QueryClient();

test("heroQuery asks for random movies that have a backdrop and a logo, with media sources, and leads with HDR", async () => {
  itemsBody = {
    Items: [
      { Id: "a", MediaSources: [sdr] },
      { Id: "b", MediaSources: [hdr] },
      { Id: "c" },
      { Id: "d", MediaSources: [hdr] },
      { Id: "e", MediaSources: [sdr] },
      { Id: "f", MediaSources: [sdr] },
    ],
  };
  const films = await fresh().fetchQuery(heroQuery(ctx));
  expect(films.map((film) => film.Id)).toEqual(["b", "d", "a", "c", "e"]);
  expect(received.map((request) => request.url)).toEqual([
    `/Items?userId=${USER}&includeItemTypes=Movie&recursive=true&imageTypes=Backdrop&imageTypes=Logo&enableImageTypes=Backdrop&enableImageTypes=Logo&imageTypeLimit=1&fields=MediaSources&sortBy=Random&limit=12`,
  ]);
  expect(received[0]?.auth).toBe(
    'MediaBrowser Client="Harakiri", Device="TV", DeviceId="dev-1", Version="0.1.0", Token="tok"'
  );
});

test("resumeQuery asks for video in progress with landscape art", async () => {
  await fresh().fetchQuery(resumeQuery(ctx));
  expect(received.map((request) => request.url)).toEqual([
    `/UserItems/Resume?userId=${USER}&mediaTypes=Video&enableImageTypes=Primary&enableImageTypes=Thumb&enableImageTypes=Backdrop&imageTypeLimit=1&limit=16`,
  ]);
});

test("nextUpQuery asks for next episodes with landscape art", async () => {
  await fresh().fetchQuery(nextUpQuery(ctx));
  expect(received.map((request) => request.url)).toEqual([
    `/Shows/NextUp?userId=${USER}&enableImageTypes=Primary&enableImageTypes=Thumb&enableImageTypes=Backdrop&imageTypeLimit=1&limit=16`,
  ]);
});

test("latestQuery asks for recently added films and shows with posters", async () => {
  await fresh().fetchQuery(latestQuery(ctx));
  expect(received.map((request) => request.url)).toEqual([
    `/Items/Latest?userId=${USER}&includeItemTypes=Movie&includeItemTypes=Series&enableImageTypes=Primary&imageTypeLimit=1&limit=16`,
  ]);
});

test("sectionsQuery groups one random page of films and series into the six largest genres", async () => {
  itemsBody = {
    Items: [
      { Id: "1", Genres: ["Drama", "Crime"] },
      { Id: "2", Genres: ["Drama"] },
      { Id: "3", Genres: ["Comedy", "Drama"] },
      { Id: "4", Genres: ["Crime"] },
      { Id: "5", Genres: ["Action"] },
      { Id: "6", Genres: ["Western"] },
      { Id: "7", Genres: ["Horror"] },
      { Id: "8", Genres: ["Animation"] },
      { Id: "9" },
    ],
  };
  const sections = await fresh().fetchQuery(sectionsQuery(ctx));
  expect(sections.map(({ title, items }) => [title, items.map((item) => item.Id)])).toEqual([
    ["Drama", ["1", "2", "3"]],
    ["Crime", ["1", "4"]],
    ["Action", ["5"]],
    ["Animation", ["8"]],
    ["Comedy", ["3"]],
    ["Horror", ["7"]],
  ]);
  expect(sections[0]?.id).toBe("genre:Drama");
  expect(received.map((request) => request.url)).toEqual([
    `/Items?userId=${USER}&includeItemTypes=Movie&includeItemTypes=Series&recursive=true&fields=Genres&enableImageTypes=Primary&imageTypeLimit=1&sortBy=Random`,
  ]);
});

test("itemQuery fetches the full item for the user", async () => {
  const item = await fresh().fetchQuery(itemQuery(ctx, SERIES));
  expect(item.Name).toBe("Fixture Film");
  expect(received.map((request) => request.url)).toEqual([`/Items/${SERIES}?userId=${USER}`]);
});

test("seasonsQuery and episodesQuery ask for one series, then one season with overviews", async () => {
  await fresh().fetchQuery(seasonsQuery(ctx, SERIES));
  await fresh().fetchQuery(episodesQuery(ctx, SERIES, SEASON));
  expect(received.map((request) => request.url)).toEqual([
    `/Shows/${SERIES}/Seasons?userId=${USER}&enableImageTypes=Primary&imageTypeLimit=1`,
    `/Shows/${SERIES}/Episodes?userId=${USER}&seasonId=${SEASON}&fields=Overview&enableImageTypes=Primary&imageTypeLimit=1`,
  ]);
});

test("publicUsersQuery and serverInfoQuery call the anonymous endpoints of the given server", async () => {
  const info = await fresh().fetchQuery(serverInfoQuery(server));
  await fresh().fetchQuery(publicUsersQuery(server));
  expect(info.ServerName).toBe("jf");
  expect(received).toEqual([
    { url: "/System/Info/Public", auth: null },
    { url: "/Users/Public", auth: null },
  ]);
});

test("query keys are scoped by server and user, so two users never share a cache entry", () => {
  const other = { ...ctx, userId: UserId.parse("00000000000000000000000000000001") };
  expect(heroQuery(ctx).queryKey).toEqual(["jellyfin", "http://jf.test", USER, "hero"]);
  expect(episodesQuery(other, SERIES, SEASON).queryKey).toEqual([
    "jellyfin",
    "http://jf.test",
    "00000000000000000000000000000001",
    "episodes",
    SERIES,
    SEASON,
  ]);
});
