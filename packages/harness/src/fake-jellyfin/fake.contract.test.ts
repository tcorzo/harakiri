import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { CATALOG, entryPath } from "../corpus/catalog";
import { readManifest } from "../corpus/generate";
import { type FakeJellyfin, startFakeJellyfin } from "./index";

/**
 * Conformance: the fake Jellyfin against a real Jellyfin 12.4 scanning the same corpus. For every
 * route the fake serves, both servers get the same request, and the check fails when the fake
 * answers a field the real server does not (a fake richer than reality hides client bugs), when a
 * field both send has another JSON type, or when a value the app reads differs. Fields only the
 * real server sends are printed, not failed: the app does not read them, or the second rule would.
 *
 * The real server is JELLYFIN_DEV_URL (default http://127.0.0.1:8096) as JELLYFIN_DEV_USER /
 * JELLYFIN_DEV_PASSWORD, and must mount the corpus (`JELLYFIN_DEV_LIBRARY=corpus mise run
 * jellyfin:up`). It fails when that server is unreachable. HARAKIRI_CONFORMANCE_REFERENCE=fake
 * compares the fake with a second fake instead, which checks the comparison itself.
 *
 * It writes resume points and play reports on the real server for corpus items and puts each
 * item's user data back, and signs its device out at the end.
 */

const REPO = resolve(import.meta.dirname, "../../../..");
const CORPUS = process.env["HARAKIRI_CORPUS_DIR"] ?? resolve(REPO, ".cache/corpus");
const REFERENCE_IS_FAKE = process.env["HARAKIRI_CONFORMANCE_REFERENCE"] === "fake";
const REAL_URL = process.env["JELLYFIN_DEV_URL"] ?? "http://127.0.0.1:8096";
const USER = process.env["JELLYFIN_DEV_USER"] ?? "harakiri";
const PASSWORD = process.env["JELLYFIN_DEV_PASSWORD"] ?? "harakiri-dev";
const TICKS = 10_000_000;

interface Answer {
  readonly status: number;
  readonly type: string;
  readonly json: unknown;
  readonly bytes: Buffer;
  readonly headers: Headers;
}

class Server {
  readonly base: string;
  readonly deviceId = `harakiri-conformance-${randomUUID()}`;
  token = "";
  userId = "";

  constructor(base: string) {
    this.base = base.endsWith("/") ? base : `${base}/`;
  }

  auth(token = this.token): string {
    const fields = `Client="harakiri-conformance", Device="vitest", DeviceId="${this.deviceId}", Version="1"`;
    return `MediaBrowser ${fields}${token === "" ? "" : `, Token="${token}"`}`;
  }

  async call(
    method: string,
    path: string,
    init: { body?: unknown; headers?: Record<string, string>; token?: string } = {},
  ): Promise<Answer> {
    const response = await fetch(new URL(path.replaceAll("{user}", this.userId), this.base), {
      method,
      headers: {
        Authorization: this.auth(init.token),
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const type = response.headers.get("content-type") ?? "";
    let json: unknown;
    if (type.includes("json") && bytes.length > 0) json = JSON.parse(bytes.toString("utf8"));
    return { status: response.status, type, json, bytes, headers: response.headers };
  }

  async signIn(): Promise<void> {
    const answer = await this.call("POST", "Users/AuthenticateByName", {
      body: { Username: USER, Pw: PASSWORD },
    });
    if (answer.status !== 200) {
      throw new Error(`Signing in to ${this.base} as ${USER} failed: HTTP ${answer.status}`);
    }
    const auth = z
      .object({ AccessToken: z.string(), User: z.object({ Id: z.string() }) })
      .parse(answer.json);
    this.token = auth.AccessToken;
    this.userId = auth.User.Id;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const kind = (value: unknown) =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

/** Every path in a JSON value with its type; array elements merge under `[]`. */
function shape(value: unknown, at = "$", out = new Map<string, Set<string>>()) {
  const types = out.get(at) ?? new Set<string>();
  types.add(kind(value));
  out.set(at, types);
  if (Array.isArray(value)) for (const element of value) shape(element, `${at}[]`, out);
  else if (isRecord(value))
    for (const [key, v] of Object.entries(value)) shape(v, `${at}.${key}`, out);
  return out;
}

const problems: string[] = [];
const realOnly = new Map<string, Set<string>>();

function compareShape(route: string, fake: unknown, real: unknown): void {
  const f = shape(fake);
  const r = shape(real);
  for (const [path, types] of f) {
    const theirs = r.get(path);
    if (theirs === undefined) {
      // A path under an array the real server sent empty says nothing about the element shape.
      const parentArray = [...r.keys()].some((p) => path.startsWith(`${p}[]`));
      const emptyThere = !parentArray && hasEmptyArrayAncestor(path, r);
      if (!emptyThere) problems.push(`${route}: the fake sends ${path}, the real server does not`);
      continue;
    }
    for (const type of types) {
      if (type !== "null" && !theirs.has(type) && !theirs.has("null")) {
        problems.push(
          `${route}: ${path} is ${type} in the fake, ${[...theirs].join("|")} in the real server`,
        );
      }
    }
  }
  for (const path of r.keys()) {
    if (!f.has(path) && !hasEmptyArrayAncestor(path, f)) {
      const seen = realOnly.get(route) ?? new Set<string>();
      seen.add(path);
      realOnly.set(route, seen);
    }
  }
}

function hasEmptyArrayAncestor(path: string, s: Map<string, Set<string>>): boolean {
  for (let i = path.lastIndexOf("[]"); i > 0; i = path.lastIndexOf("[]", i - 1)) {
    const array = path.slice(0, i);
    if (
      s.get(array)?.has("array") === true &&
      ![...s.keys()].some((p) => p.startsWith(`${array}[]`))
    )
      return true;
  }
  return false;
}

/** Values the app reads, compared exactly (RunTimeTicks within a second). */
function compareValues(
  route: string,
  fake: unknown,
  real: unknown,
  fields: readonly string[],
): void {
  if (!isRecord(fake) || !isRecord(real)) {
    problems.push(`${route}: expected objects, got ${kind(fake)} and ${kind(real)}`);
    return;
  }
  for (const field of fields) {
    const a = pick(fake, field);
    const b = pick(real, field);
    const equal =
      field.endsWith("RunTimeTicks") && typeof a === "number" && typeof b === "number"
        ? Math.abs(a - b) <= TICKS
        : JSON.stringify(a) === JSON.stringify(b);
    if (!equal)
      problems.push(
        `${route}: ${field} is ${JSON.stringify(a)} in the fake, ${JSON.stringify(b)} in the real server`,
      );
  }
}

/** A dotted path; `#` takes an array's length, `?` only whether the value is present. */
function pick(value: unknown, path: string): unknown {
  let at: unknown = value;
  for (const part of path.split(".")) {
    if (part === "#") return Array.isArray(at) ? at.length : undefined;
    if (part === "?") return at !== undefined && at !== null;
    if (part === "keys") return isRecord(at) ? Object.keys(at).toSorted() : undefined;
    at = isRecord(at) ? at[part] : undefined;
  }
  return at;
}

/** An item's identity across servers, which give it different ids. */
function itemKey(item: unknown): string {
  if (!isRecord(item)) return "?";
  const field = (k: string) => {
    const v = item[k];
    return typeof v === "string" || typeof v === "number" ? String(v) : "";
  };
  return [
    field("Type"),
    field("SeriesName"),
    field("ParentIndexNumber"),
    field("IndexNumber"),
    field("Name"),
  ].join("|");
}

const ITEM_FIELDS = [
  "Name",
  "Type",
  "IsFolder",
  "RunTimeTicks",
  "ProductionYear",
  "IndexNumber",
  "ParentIndexNumber",
  "SeriesName",
  "Overview",
  "OfficialRating",
  "ImageTags.keys",
  "BackdropImageTags.#",
  "ParentLogoImageTag.?",
  "ParentBackdropImageTags.#",
  "SeriesPrimaryImageTag.?",
  "UserData.Played",
  "UserData.PlaybackPositionTicks",
  "UserData.UnplayedItemCount",
  "MediaSources.#",
] as const;

const STREAM_FIELDS = [
  "Type",
  "Index",
  "Codec",
  "Profile",
  "VideoRange",
  "VideoRangeType",
  "DvProfile",
  "Width",
  "Height",
  "Channels",
  "ChannelLayout",
  "AudioSpatialFormat",
  "ColorTransfer",
  "Language",
  "Title",
  "IsDefault",
  "IsForced",
  "IsHearingImpaired",
  "IsExternal",
  "DisplayTitle",
  "DeliveryMethod",
] as const;

const SOURCE_FIELDS = [
  "Container",
  "RunTimeTicks",
  "Size",
  "DefaultAudioStreamIndex",
  "DefaultSubtitleStreamIndex",
  "MediaStreams.#",
  "TranscodingUrl.?",
  "SupportsDirectPlay",
] as const;

/** Harakiri's PlaybackInfo body (packages/jellyfin/src/device-profile.ts), minus the subtitle list. */
const harakiriProfile = (userId: string) => ({
  UserId: userId,
  MaxStreamingBitrate: 1_000_000_000,
  EnableDirectPlay: true,
  EnableDirectStream: true,
  EnableTranscoding: true,
  AllowVideoStreamCopy: true,
  AllowAudioStreamCopy: true,
  AutoOpenLiveStream: true,
  SubtitleStreamIndex: -1,
  DeviceProfile: {
    Name: "harakiri",
    MaxStreamingBitrate: 1_000_000_000,
    MaxStaticBitrate: 1_000_000_000,
    DirectPlayProfiles: [{ Type: "Video" }, { Type: "Audio" }, { Type: "Photo" }],
    TranscodingProfiles: [
      {
        Type: "Video",
        Container: "mp4",
        Protocol: "hls",
        Context: "Streaming",
        VideoCodec: "h264,hevc",
        AudioCodec: "eac3,ac3,truehd,dts,flac,aac,opus",
      },
    ],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: ["subrip", "ass", "ssa", "pgssub", "dvdsub", "vtt"].map((Format) => ({
      Format,
      Method: "External",
    })),
  },
});

const reasons = (source: unknown) => {
  const url = pick(source, "TranscodingUrl");
  return typeof url === "string"
    ? (new URL(url, "http://x").searchParams.get("TranscodeReasons") ?? "").split(",").toSorted()
    : [];
};

let fake: FakeJellyfin;
let reference: FakeJellyfin | undefined;
const f = { server: new Server("http://placeholder/") };
const r = { server: new Server(REAL_URL) };
const fakeItems = new Map<string, string>();
const realItems = new Map<string, string>();

async function index(server: Server, into: Map<string, string>): Promise<void> {
  const answer = await server.call(
    "GET",
    "Items?userId={user}&Recursive=true&IncludeItemTypes=Movie,Series,Season,Episode",
  );
  const items = z
    .object({ Items: z.array(z.object({ Id: z.string() }).loose()) })
    .parse(answer.json);
  for (const item of items.Items) into.set(itemKey(item), item.Id);
}

/** Both servers' ids for the item of a catalog entry, through its title and numbering. */
function both(entryId: string): { fake: string; real: string } {
  const entry = CATALOG.find((e) => e.id === entryId);
  if (entry === undefined) throw new Error(`No catalog entry ${entryId}`);
  const key =
    entry.kind === "movie"
      ? ["Movie", "", "", "", entry.meta.title].join("|")
      : ["Episode", entry.series, entry.season, entry.episode, entry.title].join("|");
  const fakeId = fakeItems.get(key);
  const realId = realItems.get(key);
  if (fakeId === undefined || realId === undefined) {
    throw new Error(
      `${entryId} is missing from the ${fakeId === undefined ? "fake" : "real"} library (${key})`,
    );
  }
  return { fake: fakeId, real: realId };
}

async function same(
  route: string,
  path: (side: "fake" | "real") => string,
  method = "GET",
  body?: (side: "fake" | "real") => unknown,
) {
  const [a, b] = await Promise.all([
    f.server.call(method, path("fake"), body === undefined ? {} : { body: body("fake") }),
    r.server.call(method, path("real"), body === undefined ? {} : { body: body("real") }),
  ]);
  if (a.status !== b.status)
    problems.push(`${route}: HTTP ${a.status} from the fake, ${b.status} from the real server`);
  compareShape(route, a.json, b.json);
  return { fake: a, real: b };
}

const itemsOf = (answer: Answer): unknown[] => {
  const json = answer.json;
  if (Array.isArray(json)) return json;
  const items = isRecord(json) ? json["Items"] : undefined;
  return Array.isArray(items) ? items : [];
};

function compareItemLists(
  route: string,
  fakeList: unknown[],
  realList: unknown[],
  ordered: boolean,
) {
  const fakeKeys = fakeList.map(itemKey);
  const realKeys = realList.map(itemKey);
  const a = ordered ? fakeKeys : fakeKeys.toSorted();
  const b = ordered ? realKeys : realKeys.toSorted();
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    problems.push(
      `${route}: items ${JSON.stringify(a)} in the fake, ${JSON.stringify(b)} in the real server`,
    );
    return;
  }
  for (const item of fakeList) {
    const twin = realList.find((other) => itemKey(other) === itemKey(item));
    compareValues(`${route} ${itemKey(item)}`, item, twin, ITEM_FIELDS);
  }
}

describe(`the fake Jellyfin against ${REFERENCE_IS_FAKE ? "a second fake" : REAL_URL}`, () => {
  beforeAll(async () => {
    fake = await startFakeJellyfin({ corpusDir: CORPUS });
    f.server = new Server(fake.url);
    if (REFERENCE_IS_FAKE) {
      reference = await startFakeJellyfin({ corpusDir: CORPUS, seed: 7 });
      r.server = new Server(reference.url);
    } else {
      const probe = await fetch(new URL("System/Info/Public", r.server.base), {
        signal: AbortSignal.timeout(3000),
      }).catch((error: unknown) => error);
      if (!(probe instanceof Response) || !probe.ok) {
        throw new Error(
          `No Jellyfin answers at ${REAL_URL}: start one on the corpus (JELLYFIN_DEV_LIBRARY=corpus mise run jellyfin:up), or set JELLYFIN_DEV_URL`,
        );
      }
    }
    await f.server.signIn();
    await r.server.signIn();
    await index(f.server, fakeItems);
    await index(r.server, realItems);
    const manifest = readManifest(CORPUS);
    const missing = manifest.entries.filter((m) => {
      try {
        both(m.id);
        return false;
      } catch {
        return true;
      }
    });
    if (missing.length > 0) {
      throw new Error(
        `The real server does not hold the corpus: ${missing.map((m) => m.path).join(", ")}. It must mount ${CORPUS}.`,
      );
    }
  }, 60_000);

  afterAll(async () => {
    for (const [route, paths] of realOnly) {
      console.info(`${route}: only the real server sends ${[...paths].join(", ")}`);
    }
    await f.server.call("POST", "Sessions/Logout").catch(() => undefined);
    await r.server.call("POST", "Sessions/Logout").catch(() => undefined);
    await fake?.close();
    await reference?.close();
  });

  test("public server info, users and Quick Connect", async () => {
    problems.length = 0;
    const info = await same("GET /System/Info/Public", () => "System/Info/Public");
    compareValues("GET /System/Info/Public", info.fake.json, info.real.json, [
      "ProductName",
      "StartupWizardCompleted",
    ]);
    await same("GET /Users/Public", () => "Users/Public");
    await same("GET /Users/Me", () => "Users/Me");
    await same("GET /Users/{id}", () => "Users/{user}");
    const enabled = await same("GET /QuickConnect/Enabled", () => "QuickConnect/Enabled");
    if (enabled.real.json === true) {
      const started = await same(
        "POST /QuickConnect/Initiate",
        () => "QuickConnect/Initiate",
        "POST",
      );
      const secret = (side: "fake" | "real") => String(pick(started[side].json, "Secret"));
      const code = (side: "fake" | "real") => String(pick(started[side].json, "Code"));
      await same("GET /QuickConnect/Connect", (s) => `QuickConnect/Connect?secret=${secret(s)}`);
      await same(
        "POST /QuickConnect/Authorize",
        (s) => `QuickConnect/Authorize?code=${code(s)}&userId={user}`,
        "POST",
      );
      const signed = await same(
        "POST /Users/AuthenticateWithQuickConnect",
        () => "Users/AuthenticateWithQuickConnect",
        "POST",
        (s) => ({ Secret: secret(s) }),
      );
      for (const [side, server] of [
        ["fake", f.server],
        ["real", r.server],
      ] as const) {
        const token = pick(signed[side].json, "AccessToken");
        // The Quick Connect sign-in shares this device id, so it replaced the test's token.
        if (typeof token === "string") server.token = token;
      }
    }
    expect(problems).toEqual([]);
  });

  test("views, library rows, genres and title pages", async () => {
    problems.length = 0;
    await same("GET /UserViews", () => "UserViews?userId={user}");
    const hero = await same(
      "GET /Items (hero)",
      () =>
        "Items?userId={user}&includeItemTypes=Movie&recursive=true&imageTypes=Backdrop,Logo&enableImageTypes=Backdrop,Logo&imageTypeLimit=1&fields=MediaSources&sortBy=Random&limit=100",
    );
    compareItemLists("GET /Items (hero)", itemsOf(hero.fake), itemsOf(hero.real), false);
    const sections = await same(
      "GET /Items (sections)",
      () =>
        "Items?userId={user}&includeItemTypes=Movie,Series&recursive=true&fields=Genres&enableImageTypes=Primary&imageTypeLimit=1&sortBy=Random",
    );
    compareItemLists(
      "GET /Items (sections)",
      itemsOf(sections.fake),
      itemsOf(sections.real),
      false,
    );
    for (const item of itemsOf(sections.fake)) {
      const twin = itemsOf(sections.real).find((o) => itemKey(o) === itemKey(item));
      const genres = (v: unknown) =>
        JSON.stringify(z.array(z.string()).catch([]).parse(pick(v, "Genres")).toSorted());
      if (genres(item) !== genres(twin))
        problems.push(
          `GET /Items (sections) ${itemKey(item)}: Genres ${genres(item)} vs ${genres(twin)}`,
        );
    }
    const catalogue = await same(
      "GET /Items (catalogue)",
      () =>
        "Items?userId={user}&recursive=true&includeItemTypes=Movie,Series&sortBy=DateCreated,SortName&sortOrder=Ascending&enableImages=false&enableUserData=false",
    );
    compareItemLists(
      "GET /Items (catalogue)",
      itemsOf(catalogue.fake),
      itemsOf(catalogue.real),
      false,
    );
    const picked = await same(
      "GET /Items (e2e pick)",
      () => "Items?userId={user}&Recursive=true&IncludeItemTypes=Movie,Episode&Fields=MediaSources",
    );
    compareItemLists("GET /Items (e2e pick)", itemsOf(picked.fake), itemsOf(picked.real), false);
    const latest = await same(
      "GET /Items/Latest",
      () =>
        "Items/Latest?userId={user}&includeItemTypes=Movie,Series&enableImageTypes=Primary&imageTypeLimit=1&limit=16",
    );
    compareItemLists("GET /Items/Latest", itemsOf(latest.fake), itemsOf(latest.real), false);
    await same("GET /Genres", () => "Genres?userId={user}&includeItemTypes=Movie,Series");

    for (const entry of CATALOG.filter((e) =>
      readManifest(CORPUS).entries.some((m) => m.id === e.id),
    )) {
      const ids = both(entry.id);
      const route = `GET /Items/{id} ${entry.id}`;
      const detail = await same(route, (s) => `Items/${ids[s]}?userId={user}`);
      compareValues(route, detail.fake.json, detail.real.json, ITEM_FIELDS);
    }

    const series = [...fakeItems.keys()].filter((k) => k.startsWith("Series|"));
    for (const key of series) {
      const ids = { fake: fakeItems.get(key) ?? "", real: realItems.get(key) ?? "" };
      const seasons = await same(
        `GET /Shows/{id}/Seasons ${key}`,
        (s) => `Shows/${ids[s]}/Seasons?userId={user}&enableImageTypes=Primary&imageTypeLimit=1`,
      );
      compareItemLists(
        `GET /Shows/{id}/Seasons ${key}`,
        itemsOf(seasons.fake),
        itemsOf(seasons.real),
        true,
      );
      const [fakeSeason] = itemsOf(seasons.fake);
      const [realSeason] = itemsOf(seasons.real);
      const season = { fake: String(pick(fakeSeason, "Id")), real: String(pick(realSeason, "Id")) };
      const episodes = await same(
        `GET /Shows/{id}/Episodes ${key}`,
        (s) =>
          `Shows/${ids[s]}/Episodes?userId={user}&seasonId=${season[s]}&fields=Overview&enableImageTypes=Primary&imageTypeLimit=1`,
      );
      compareItemLists(
        `GET /Shows/{id}/Episodes ${key}`,
        itemsOf(episodes.fake),
        itemsOf(episodes.real),
        true,
      );
      const [first] = itemsOf(episodes.fake);
      const [realFirst] = itemsOf(episodes.real);
      const start = { fake: String(pick(first, "Id")), real: String(pick(realFirst, "Id")) };
      const next = await same(
        `GET /Shows/{id}/Episodes (next) ${key}`,
        (s) =>
          `Shows/${ids[s]}/Episodes?userId={user}&startItemId=${start[s]}&limit=2&enableImageTypes=Primary,Thumb,Backdrop&imageTypeLimit=1`,
      );
      compareItemLists(
        `GET /Shows/{id}/Episodes (next) ${key}`,
        itemsOf(next.fake),
        itemsOf(next.real),
        true,
      );
    }
    expect(problems).toEqual([]);
  }, 120_000);

  test("PlaybackInfo decides the same way for every corpus file", async () => {
    problems.length = 0;
    const entries = CATALOG.filter((e) => readManifest(CORPUS).entries.some((m) => m.id === e.id));
    for (const entry of entries) {
      const ids = both(entry.id);
      const route = `POST /Items/{id}/PlaybackInfo ${entry.id}`;
      const answer = await same(
        route,
        (s) => `Items/${ids[s]}/PlaybackInfo`,
        "POST",
        (s) => harakiriProfile(s === "fake" ? f.server.userId : r.server.userId),
      );
      const fakeSource = itemsOfSources(answer.fake)[0];
      const realSource = itemsOfSources(answer.real)[0];
      compareValues(route, fakeSource, realSource, SOURCE_FIELDS);
      const fs = z.array(z.unknown()).catch([]).parse(pick(fakeSource, "MediaStreams"));
      const rs = z.array(z.unknown()).catch([]).parse(pick(realSource, "MediaStreams"));
      fs.forEach((stream, i) =>
        compareValues(`${route} stream ${i}`, stream, rs[i], STREAM_FIELDS),
      );
      // A sidecar URL must fetch the same file from both.
      const sidecar = (streams: unknown[]) =>
        streams.find(
          (s) => pick(s, "IsExternal") === true && typeof pick(s, "DeliveryUrl") === "string",
        );
      const fakeSidecar = sidecar(fs);
      const realSidecar = sidecar(rs);
      if ((fakeSidecar === undefined) !== (realSidecar === undefined)) {
        problems.push(
          `${route}: a sidecar DeliveryUrl in ${fakeSidecar ? "the fake" : "the real server"} only`,
        );
      } else if (fakeSidecar !== undefined && realSidecar !== undefined) {
        const [a, b] = await Promise.all([
          f.server.call("GET", String(pick(fakeSidecar, "DeliveryUrl")).replace(/^\//, "")),
          r.server.call("GET", String(pick(realSidecar, "DeliveryUrl")).replace(/^\//, "")),
        ]);
        if (a.status !== b.status || !a.bytes.equals(b.bytes)) {
          problems.push(
            `${route}: the sidecar answers HTTP ${a.status} (${a.bytes.length} B) from the fake, ${b.status} (${b.bytes.length} B) from the real server`,
          );
        }
      }
    }
    // Negative controls: profiles that real Jellyfin transcodes, for the reasons it names.
    const dv = both("dv-p5-hevc-episode");
    const rangeCondition = (s: "fake" | "real") => ({
      ...harakiriProfile(s === "fake" ? f.server.userId : r.server.userId),
      DeviceProfile: {
        ...harakiriProfile("").DeviceProfile,
        CodecProfiles: [
          {
            Type: "Video",
            Codec: "hevc",
            Conditions: [
              {
                Condition: "EqualsAny",
                Property: "VideoRangeType",
                Value: "SDR|HDR10|HLG",
                IsRequired: false,
              },
            ],
          },
        ],
      },
    });
    const controlled = await same(
      "PlaybackInfo with a VideoRangeType condition",
      (s) => `Items/${dv[s]}/PlaybackInfo`,
      "POST",
      rangeCondition,
    );
    const decided = (a: Answer) => reasons(itemsOfSources(a)[0]);
    if (JSON.stringify(decided(controlled.fake)) !== JSON.stringify(decided(controlled.real))) {
      problems.push(
        `PlaybackInfo with a VideoRangeType condition: ${decided(controlled.fake).join(",")} in the fake, ${decided(controlled.real).join(",")} in the real server`,
      );
    }
    const capped = both("sdr-h264-eac3-long");
    const lowCap = (s: "fake" | "real") => ({
      ...harakiriProfile(s === "fake" ? f.server.userId : r.server.userId),
      MaxStreamingBitrate: 10_000,
    });
    const starved = await same(
      "PlaybackInfo under a 10 kbit/s cap",
      (s) => `Items/${capped[s]}/PlaybackInfo`,
      "POST",
      lowCap,
    );
    if (JSON.stringify(decided(starved.fake)) !== JSON.stringify(decided(starved.real))) {
      problems.push(
        `PlaybackInfo under a 10 kbit/s cap: ${decided(starved.fake).join(",")} in the fake, ${decided(starved.real).join(",")} in the real server`,
      );
    }
    expect(problems).toEqual([]);
  }, 120_000);

  test("resume points, played marks, play reports, sessions and devices", async () => {
    problems.length = 0;
    const movie = both("sdr-h264-aac-long");
    const episode = both("sdr-h264-episode");
    const saved = {
      fake: (await f.server.call("GET", `UserItems/${movie.fake}/UserData?userId={user}`)).json,
      real: (await r.server.call("GET", `UserItems/${movie.real}/UserData?userId={user}`)).json,
    };
    const savedEpisode = {
      fake: (await f.server.call("GET", `UserItems/${episode.fake}/UserData?userId={user}`)).json,
      real: (await r.server.call("GET", `UserItems/${episode.real}/UserData?userId={user}`)).json,
    };
    try {
      const data = await same(
        "GET /UserItems/{id}/UserData",
        (s) => `UserItems/${movie[s]}/UserData?userId={user}`,
      );
      compareValues("GET /UserItems/{id}/UserData", data.fake.json, data.real.json, [
        "Played",
        "PlaybackPositionTicks",
      ]);
      const written = await same(
        "POST /UserItems/{id}/UserData",
        (s) => `UserItems/${movie[s]}/UserData?userId={user}`,
        "POST",
        () => ({
          PlaybackPositionTicks: 120 * TICKS,
          Played: false,
          LastPlayedDate: new Date().toISOString(),
        }),
      );
      compareValues("POST /UserItems/{id}/UserData", written.fake.json, written.real.json, [
        "PlaybackPositionTicks",
        "Played",
        "PlayedPercentage",
      ]);
      const resume = await same(
        "GET /UserItems/Resume",
        () =>
          "UserItems/Resume?userId={user}&mediaTypes=Video&enableImageTypes=Primary,Thumb,Backdrop&imageTypeLimit=1&limit=16",
      );
      compareItemLists("GET /UserItems/Resume", itemsOf(resume.fake), itemsOf(resume.real), true);

      const played = await same(
        "POST /UserPlayedItems/{id}",
        (s) => `UserPlayedItems/${episode[s]}?userId={user}`,
        "POST",
      );
      compareValues("POST /UserPlayedItems/{id}", played.fake.json, played.real.json, [
        "Played",
        "PlaybackPositionTicks",
      ]);
      const nextUp = await same(
        "GET /Shows/NextUp",
        () =>
          "Shows/NextUp?userId={user}&enableImageTypes=Primary,Thumb,Backdrop&imageTypeLimit=1&limit=16",
      );
      compareItemLists("GET /Shows/NextUp", itemsOf(nextUp.fake), itemsOf(nextUp.real), true);
      await same(
        "DELETE /UserPlayedItems/{id}",
        (s) => `UserPlayedItems/${episode[s]}?userId={user}`,
        "DELETE",
      );

      const report =
        (position: number, paused = false) =>
        (s: "fake" | "real") => ({
          ItemId: movie[s],
          MediaSourceId: movie[s],
          PlayMethod: "DirectPlay",
          PositionTicks: position * TICKS,
          IsPaused: paused,
          CanSeek: true,
        });
      await same("POST /Sessions/Playing", () => "Sessions/Playing", "POST", report(200));
      await same(
        "POST /Sessions/Playing/Progress",
        () => "Sessions/Playing/Progress",
        "POST",
        report(210, true),
      );
      const sessions = await same(
        "GET /Sessions",
        (s) => `Sessions?deviceId=${(s === "fake" ? f.server : r.server).deviceId}`,
      );
      const nowPlaying = (a: Answer) => {
        const [session] = itemsOf(a);
        return {
          playing: itemKey(pick(session, "NowPlayingItem")),
          paused: pick(session, "PlayState.IsPaused"),
          method: pick(session, "PlayState.PlayMethod"),
        };
      };
      if (JSON.stringify(nowPlaying(sessions.fake)) !== JSON.stringify(nowPlaying(sessions.real))) {
        problems.push(
          `GET /Sessions: ${JSON.stringify(nowPlaying(sessions.fake))} in the fake, ${JSON.stringify(nowPlaying(sessions.real))} in the real server`,
        );
      }
      await same(
        "POST /Sessions/Playing/Stopped",
        () => "Sessions/Playing/Stopped",
        "POST",
        report(215),
      );
      const after = await same(
        "GET /UserItems/{id}/UserData after a stop",
        (s) => `UserItems/${movie[s]}/UserData?userId={user}`,
      );
      compareValues("UserData after a stop at 215 s", after.fake.json, after.real.json, [
        "PlaybackPositionTicks",
        "Played",
      ]);
      await same("POST /Sessions/Playing (early)", () => "Sessions/Playing", "POST", report(5));
      await same(
        "POST /Sessions/Playing/Stopped (early)",
        () => "Sessions/Playing/Stopped",
        "POST",
        report(10),
      );
      const early = await same(
        "GET /UserItems/{id}/UserData after an early stop",
        (s) => `UserItems/${movie[s]}/UserData?userId={user}`,
      );
      compareValues("UserData after a stop at 10 s (under 5%)", early.fake.json, early.real.json, [
        "PlaybackPositionTicks",
        "Played",
      ]);
      const cleared = await same(
        "GET /Sessions after the stop",
        (s) => `Sessions?deviceId=${(s === "fake" ? f.server : r.server).deviceId}`,
      );
      if (nowPlaying(cleared.fake).playing !== nowPlaying(cleared.real).playing) {
        problems.push("GET /Sessions after a stop: now playing differs");
      }
      await same("GET /Devices", () => "Devices");
    } finally {
      for (const [server, side] of [
        [f.server, "fake"],
        [r.server, "real"],
      ] as const) {
        for (const [id, data] of [
          [movie[side], saved[side]],
          [episode[side], savedEpisode[side]],
        ] as const) {
          await server.call("POST", `UserItems/${id}/UserData?userId={user}`, { body: data });
        }
      }
    }
    expect(problems).toEqual([]);
  }, 60_000);

  test("images, the video stream with Range, unknown routes and sign-out", async () => {
    problems.length = 0;
    const movie = both("sdr-h264-aac-long");
    for (const type of ["Primary", "Backdrop", "Logo", "Thumb"]) {
      const [a, b] = await Promise.all([
        f.server.call("GET", `Items/${movie.fake}/Images/${type}?maxWidth=300&quality=90`),
        r.server.call("GET", `Items/${movie.real}/Images/${type}?maxWidth=300&quality=90`),
      ]);
      if (a.status !== b.status)
        problems.push(`GET /Items/{id}/Images/${type}: HTTP ${a.status} vs ${b.status}`);
      if (a.status === 200 && !(a.type.startsWith("image/") && b.type.startsWith("image/"))) {
        problems.push(`GET /Items/{id}/Images/${type}: ${a.type} vs ${b.type}`);
      }
    }
    const entry = CATALOG.find((e) => e.id === "sdr-h264-aac-long");
    if (entry === undefined) throw new Error("The catalog lost sdr-h264-aac-long");
    const file = readFileSync(join(CORPUS, entryPath(entry)));
    for (const range of ["bytes=0-1023", "bytes=1000000-1000999", `bytes=${file.length - 100}-`]) {
      const [a, b] = await Promise.all([
        f.server.call(
          "GET",
          `Videos/${movie.fake}/stream?static=true&MediaSourceId=${movie.fake}`,
          { headers: { Range: range } },
        ),
        r.server.call(
          "GET",
          `Videos/${movie.real}/stream?static=true&MediaSourceId=${movie.real}`,
          { headers: { Range: range } },
        ),
      ]);
      if (a.status !== 206 || b.status !== 206)
        problems.push(`stream ${range}: HTTP ${a.status} vs ${b.status}`);
      if (a.headers.get("content-range") !== b.headers.get("content-range")) {
        problems.push(
          `stream ${range}: Content-Range ${a.headers.get("content-range")} vs ${b.headers.get("content-range")}`,
        );
      }
      if (!a.bytes.equals(b.bytes)) problems.push(`stream ${range}: the bytes differ`);
    }
    const anonymous = await Promise.all([
      f.server.call("GET", `Videos/${movie.fake}/stream?static=true`, { token: "" }),
      r.server.call("GET", `Videos/${movie.real}/stream?static=true`, { token: "" }),
    ]);
    if (anonymous[0].status !== anonymous[1].status) {
      problems.push(
        `stream without a token: HTTP ${anonymous[0].status} vs ${anonymous[1].status}`,
      );
    }
    const unknown = await same("GET an unknown route", () => "Harakiri/NoSuchRoute");
    if (unknown.fake.status !== 404)
      problems.push(`unknown route: HTTP ${unknown.fake.status} from the fake`);
    await same("POST /Sessions/Logout", () => "Sessions/Logout", "POST");
    const gone = await same("GET /Users/Me after sign-out", () => "Users/Me");
    if (gone.fake.status !== 401)
      problems.push(`GET /Users/Me after sign-out: HTTP ${gone.fake.status} from the fake`);
    expect(problems).toEqual([]);
  });
});

function itemsOfSources(answer: Answer): unknown[] {
  const sources = pick(answer.json, "MediaSources");
  return Array.isArray(sources) ? sources : [];
}
