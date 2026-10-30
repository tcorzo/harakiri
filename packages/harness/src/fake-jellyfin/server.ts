import { createSocket, type Socket } from "node:dgram";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname } from "node:path";
import { match } from "ts-pattern";
import { z } from "zod";
import {
  ALL_FIELDS,
  baseItem,
  deviceDto,
  type DtoOptions,
  episodesUnder,
  genreId,
  publicUserDto,
  queryResult,
  SERVER_ID,
  SERVER_VERSION,
  sessionDto,
  userDto,
  userItemData,
} from "./dto";
import {
  type EpisodeItem,
  IMAGE_TYPES,
  type Item,
  isVideo,
  itemOf,
  type Library,
  loadLibrary,
} from "./library";
import { PlaybackInfoBody, playbackInfo } from "./playback-info";
import {
  type Client,
  type Device,
  FakeState,
  startPlayState,
  updatePlayState,
  type UserSpec,
} from "./state";

export interface FakeJellyfinOptions {
  /** A generated corpus (`mise run media:gen`): its corpus.json and files are the library. */
  readonly corpusDir: string;
  readonly serverName?: string;
  /** Default: one hidden administrator, `harakiri` / `harakiri-dev`, like the dev server. */
  readonly users?: readonly UserSpec[];
  /** Answer Jellyfin's UDP discovery probe on this address (port 7359 unless given). */
  readonly discovery?: { readonly address: string; readonly port?: number };
  /** Seeds `SortBy=Random`, so a run can be replayed. */
  readonly seed?: number;
}

export interface FakeJellyfin {
  /** The base URL, as ServerUrl parses it: `http://127.0.0.1:<port>/`. */
  readonly url: string;
  /** Host and port, as an owner would type it. */
  readonly address: string;
  readonly serverName: string;
  readonly state: FakeState;
  readonly library: Library;
  /** Every request, as `METHOD /path`, in order. */
  readonly requests: readonly string[];
  /** Requests no route serves (answered 404) or bodies that failed validation (answered 400). */
  readonly unexpected: readonly string[];
  /** The item id of a catalog entry, or undefined when the corpus does not hold it. */
  readonly itemId: (entryId: string) => string | undefined;
  readonly close: () => Promise<void>;
}

export const DEFAULT_USERS: readonly UserSpec[] = [
  { name: "harakiri", password: "harakiri-dev", hidden: true, administrator: true },
];

interface Auth {
  readonly client: Partial<Client>;
  readonly token: string | undefined;
}

interface Context {
  readonly method: string;
  readonly path: string;
  readonly params: readonly string[];
  readonly query: ReadonlyMap<string, readonly string[]>;
  readonly auth: Auth;
  readonly device: Device | undefined;
  readonly body: () => Promise<unknown>;
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
}

type Reply =
  | { readonly status: number; readonly json?: unknown }
  | { readonly status: "sent" }
  | { readonly status: "invalid"; readonly issues: string };

interface Route {
  readonly method: string;
  readonly pattern: RegExp;
  readonly auth: "none" | "user" | "admin";
  readonly handle: (ctx: Context) => Reply | Promise<Reply>;
}

/** The signed-in device of a route that requires one; the router answers 401 before it runs. */
function caller(ctx: Context): Device {
  if (ctx.device === undefined)
    throw new Error("unreachable: a signed-in route ran without a device");
  return ctx.device;
}

const json = (value: unknown, status = 200): Reply => ({ status, json: value });
const empty = (status = 204): Reply => ({ status });

/** The Authorization header's MediaBrowser fields, URL-decoded as Jellyfin reads them. */
function parseAuth(request: IncomingMessage, query: ReadonlyMap<string, readonly string[]>): Auth {
  const header = request.headers["authorization"] ?? request.headers["x-emby-authorization"] ?? "";
  const fields = new Map<string, string>();
  const text = Array.isArray(header) ? (header[0] ?? "") : header;
  if (/^\s*(MediaBrowser|Emby)\s/i.test(text)) {
    for (const [, key, value] of text.matchAll(/(\w+)="([^"]*)"/g)) {
      if (key !== undefined && value !== undefined)
        fields.set(key.toLowerCase(), decodeURIComponent(value));
    }
  }
  const tokenHeader = request.headers["x-emby-token"] ?? request.headers["x-mediabrowser-token"];
  const token =
    fields.get("token") ??
    (typeof tokenHeader === "string" ? tokenHeader : undefined) ??
    query.get("apikey")?.[0] ??
    query.get("api_key")?.[0];
  return {
    client: {
      client: fields.get("client"),
      device: fields.get("device"),
      deviceId: fields.get("deviceid"),
      version: fields.get("version"),
    },
    token,
  };
}

const fullClient = (auth: Auth): Client | undefined => {
  const { client, device, deviceId, version } = auth.client;
  return client && device && deviceId && version
    ? { client, device, deviceId, version }
    : undefined;
};

/** Query parameters, keyed case-insensitively; comma lists and repeated keys both split. */
function parseQuery(url: URL): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [key, value] of url.searchParams) {
    const k = key.toLowerCase();
    out.set(k, [...(out.get(k) ?? []), ...value.split(",").filter((v) => v !== "")]);
  }
  return out;
}

/** Template to regex: `{id}` captures one segment; matching ignores case like ASP.NET routing. */
const path = (template: string) =>
  new RegExp(`^${template.replaceAll(/\{[^}]+\}/g, "([^/]+)")}$`, "i");

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UpdateUserData = z.object({
  PlaybackPositionTicks: z.number().int().nullish(),
  PlayCount: z.number().int().nullish(),
  IsFavorite: z.boolean().nullish(),
  Played: z.boolean().nullish(),
  LastPlayedDate: z.string().nullish(),
});

const PlaybackReport = z.object({
  ItemId: z.string(),
  MediaSourceId: z.string().nullish(),
  PlaySessionId: z.string().nullish(),
  PlayMethod: z.enum(["DirectPlay", "DirectStream", "Transcode"]).nullish(),
  PositionTicks: z.number().int().nullish(),
  IsPaused: z.boolean().nullish(),
  AudioStreamIndex: z.number().int().nullish(),
  SubtitleStreamIndex: z.number().int().nullish(),
  Failed: z.boolean().nullish(),
});

const Credentials = z.object({ Username: z.string(), Pw: z.string().nullish() });
const QuickConnectSecret = z.object({ Secret: z.string() });

const CONTENT_TYPE: Readonly<Record<string, string>> = {
  ".mkv": "video/x-matroska",
  ".mp4": "video/mp4",
  ".m2ts": "video/mp2t",
  ".ts": "video/mp2t",
  ".ass": "text/x-ssa",
  ".sup": "application/octet-stream",
  ".png": "image/png",
};

export async function startFakeJellyfin(options: FakeJellyfinOptions): Promise<FakeJellyfin> {
  const library = await loadLibrary(options.corpusDir);
  const state = new FakeState(options.users ?? DEFAULT_USERS);
  const serverName = options.serverName ?? "harakiri-fake";
  const random = mulberry32(options.seed ?? 1);
  const requests: string[] = [];
  const unexpected: string[] = [];
  let url = "";

  const item = (id: string | undefined): Item | undefined =>
    id === undefined ? undefined : library.items.get(id.replaceAll("-", "").toLowerCase());
  const userOf = (ctx: Context) => {
    const id = ctx.query.get("userid")?.[0] ?? ctx.device?.userId;
    return id === undefined ? undefined : state.user(id);
  };
  const flag = (ctx: Context, key: string, fallback: boolean) => {
    const value = ctx.query.get(key)?.[0];
    return value === undefined ? fallback : value.toLowerCase() === "true";
  };
  const lowerSet = (values: readonly string[] | undefined) =>
    values === undefined ? undefined : new Set(values.map((v) => v.toLowerCase()));
  const dtoOptions = (ctx: Context): DtoOptions => {
    const limit = ctx.query.get("imagetypelimit")?.[0];
    return {
      fields: lowerSet(ctx.query.get("fields")) ?? new Set(),
      enableImages: flag(ctx, "enableimages", true),
      enableUserData: flag(ctx, "enableuserdata", true),
      imageTypes: lowerSet(ctx.query.get("enableimagetypes")),
      imageTypeLimit: limit === undefined ? undefined : Number(limit),
    };
  };
  const render = (ctx: Context, items: readonly Item[], o = dtoOptions(ctx)) =>
    items.map((i) => baseItem(state, library, userOf(ctx)?.id, i, o));
  const page = <T>(ctx: Context, items: readonly T[]) => {
    const start = Number(ctx.query.get("startindex")?.[0] ?? 0);
    const limit = ctx.query.get("limit")?.[0];
    return items.slice(start, limit === undefined ? undefined : start + Number(limit));
  };
  const types = (ctx: Context) => lowerSet(ctx.query.get("includeitemtypes"));
  const ofTypes = (wanted: ReadonlySet<string> | undefined, i: Item) =>
    wanted === undefined || wanted.has(i.type.toLowerCase());
  const lastPlayed = (userId: string, i: Item) =>
    Date.parse(state.data(userId, i.id).lastPlayedDate ?? "") || 0;
  const runtime = (i: Item) => (isVideo(i) ? i.probed.runTimeTicks : undefined);

  function children(parentId: string): Item[] {
    const parent = item(parentId);
    if (parent === undefined) return [];
    return match(parent)
      .with({ type: "CollectionFolder" }, (p) =>
        [...library.items.values()].filter((i) =>
          p.collectionType === "movies" ? i.type === "Movie" : i.type === "Series",
        ),
      )
      .with({ type: "Series" }, (p) => p.seasonIds.map((id) => itemOf(library.items, id, "Season")))
      .with({ type: "Season" }, (p) =>
        p.episodeIds.map((id) => itemOf(library.items, id, "Episode")),
      )
      .otherwise(() => []);
  }

  function sortItems(ctx: Context, items: Item[], userId: string | undefined): Item[] {
    const keys = ctx.query.get("sortby") ?? ["SortName"];
    const orders = ctx.query.get("sortorder") ?? [];
    if (keys.some((k) => k.toLowerCase() === "random")) {
      const shuffled = [...items];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const a = shuffled[i];
        const b = shuffled[j];
        if (a !== undefined && b !== undefined) [shuffled[i], shuffled[j]] = [b, a];
      }
      return shuffled;
    }
    const value = (key: string, i: Item): string | number | bigint =>
      match(key.toLowerCase())
        .with("datecreated", () => i.createdNs)
        .with("dateplayed", () => (userId === undefined ? 0 : lastPlayed(userId, i)))
        .with("productionyear", "premieredate", () =>
          i.type === "Movie" || i.type === "Episode"
            ? i.year
            : i.type === "Series"
              ? i.meta.year
              : 0,
        )
        .with("indexnumber", () =>
          i.type === "Episode" ? i.entry.episode : i.type === "Season" ? i.index : 0,
        )
        .with("runtime", () => runtime(i) ?? 0)
        .otherwise(() => i.sortName);
    return items.toSorted((a, b) => {
      for (const [n, key] of keys.entries()) {
        const descending = (orders[n] ?? orders[0] ?? "Ascending").toLowerCase() === "descending";
        const [x, y] = [value(key, a), value(key, b)];
        if (x !== y) return (x < y ? -1 : 1) * (descending ? -1 : 1);
      }
      return 0;
    });
  }

  function itemsQuery(ctx: Context): Reply {
    const user = userOf(ctx);
    const parentId = ctx.query.get("parentid")?.[0];
    const recursive = flag(ctx, "recursive", false);
    // Ids name items anywhere in the library, as Jellyfin answers them without Recursive.
    let items: Item[] =
      recursive || ctx.query.has("ids")
        ? [...library.items.values()].filter((i) => i.type !== "CollectionFolder")
        : parentId === undefined
          ? [...library.views]
          : children(parentId);
    if (recursive && parentId !== undefined) {
      const roots = children(parentId);
      const under = new Set(
        roots.flatMap((r) => [
          r.id,
          ...episodesUnder(library, r).map((e) => e.id),
          ...(r.type === "Series" ? r.seasonIds : []),
        ]),
      );
      items = items.filter((i) => under.has(i.id));
    }
    const wanted = types(ctx);
    const excluded = lowerSet(ctx.query.get("excludeitemtypes"));
    const ids = ctx.query.get("ids")?.map((id) => id.replaceAll("-", "").toLowerCase());
    const search = ctx.query.get("searchterm")?.join(",").toLowerCase();
    const needImages = ctx.query
      .get("imagetypes")
      ?.map((name) => IMAGE_TYPES.find((t) => t.toLowerCase() === name.toLowerCase()));
    const filters = lowerSet(ctx.query.get("filters")) ?? new Set();
    const played = ctx.query.get("isplayed")?.[0];
    const genres = lowerSet(ctx.query.get("genres"));
    items = items.filter((i) => {
      if (!ofTypes(wanted, i)) return false;
      if (excluded?.has(i.type.toLowerCase()) === true) return false;
      if (ids !== undefined && !ids.includes(i.id)) return false;
      if (search !== undefined && !i.name.toLowerCase().includes(search)) return false;
      if (needImages?.some((type) => type === undefined || i.images[type] === undefined) === true)
        return false;
      if (genres !== undefined) {
        const own = i.type === "Movie" ? i.genres : i.type === "Series" ? i.meta.genres : [];
        if (!own.some((g) => genres.has(g.toLowerCase()))) return false;
      }
      const data = user === undefined ? undefined : state.data(user.id, i.id);
      if (played !== undefined && (data?.played ?? false) !== (played.toLowerCase() === "true"))
        return false;
      if (filters.has("isresumable") && !((data?.playbackPositionTicks ?? 0) > 0)) return false;
      if (filters.has("isplayed") && data?.played !== true) return false;
      if (filters.has("isunplayed") && data?.played === true) return false;
      if (filters.has("isfavorite") && data?.isFavorite !== true) return false;
      return true;
    });
    const sorted = sortItems(ctx, items, user?.id);
    return json(
      queryResult(
        render(ctx, page(ctx, sorted)),
        sorted.length,
        Number(ctx.query.get("startindex")?.[0] ?? 0),
      ),
    );
  }

  function latest(ctx: Context): Reply {
    const user = userOf(ctx);
    const wanted = types(ctx) ?? new Set(["movie", "series", "episode"]);
    const parentId = ctx.query.get("parentid")?.[0];
    const scope = parentId === undefined ? undefined : new Set(children(parentId).map((i) => i.id));
    const items = [...library.items.values()]
      .filter((i) => ofTypes(wanted, i) && i.type !== "Season" && i.type !== "CollectionFolder")
      .filter((i) => scope === undefined || scope.has(i.id))
      // The user's HidePlayedInLatest (on by default) leaves out what they finished.
      .filter((i) => user === undefined || !state.data(user.id, i.id).played)
      .toSorted((a, b) => (a.createdNs === b.createdNs ? 0 : a.createdNs < b.createdNs ? 1 : -1))
      .slice(0, Number(ctx.query.get("limit")?.[0] ?? 20));
    return json(render(ctx, items));
  }

  function resume(ctx: Context): Reply {
    const user = userOf(ctx);
    if (user === undefined) return empty(400);
    const wanted = types(ctx);
    const items = [...library.items.values()]
      .filter(isVideo)
      .filter((i) => ofTypes(wanted, i))
      .filter((i) => {
        const data = state.data(user.id, i.id);
        return data.playbackPositionTicks > 0 && !data.played;
      })
      .toSorted((a, b) => lastPlayed(user.id, b) - lastPlayed(user.id, a));
    return json(queryResult(render(ctx, page(ctx, items)), items.length));
  }

  function nextUp(ctx: Context): Reply {
    const user = userOf(ctx);
    if (user === undefined) return empty(400);
    const only = ctx.query.get("seriesid")?.[0]?.replaceAll("-", "").toLowerCase();
    const found: { episode: EpisodeItem; when: number }[] = [];
    for (const series of library.items.values()) {
      if (series.type !== "Series" || (only !== undefined && series.id !== only)) continue;
      const all = episodesUnder(library, series);
      const watched = all.filter((e) => state.data(user.id, e.id).played);
      const last = watched.toSorted((a, b) => lastPlayed(user.id, b) - lastPlayed(user.id, a))[0];
      if (last === undefined) continue;
      const next = all.slice(all.indexOf(last) + 1).find((e) => !state.data(user.id, e.id).played);
      if (next !== undefined) found.push({ episode: next, when: lastPlayed(user.id, last) });
    }
    const items = found.toSorted((a, b) => b.when - a.when).map((f) => f.episode);
    return json(queryResult(render(ctx, page(ctx, items)), items.length));
  }

  function episodes(ctx: Context): Reply {
    const series = item(ctx.params[0]);
    if (series?.type !== "Series") return empty(404);
    const seasonId = ctx.query.get("seasonid")?.[0]?.replaceAll("-", "").toLowerCase();
    let list = episodesUnder(library, series).filter(
      (e) => seasonId === undefined || e.seasonId === seasonId,
    );
    const startId = ctx.query.get("startitemid")?.[0]?.replaceAll("-", "").toLowerCase();
    if (startId !== undefined) {
      const at = list.findIndex((e) => e.id === startId);
      list = at < 0 ? [] : list.slice(at);
    }
    const shown = list.slice(
      0,
      ctx.query.has("limit") ? Number(ctx.query.get("limit")?.[0]) : undefined,
    );
    return json(queryResult(render(ctx, shown), list.length));
  }

  /** Validates a request body at the boundary; a body that fails answers 400 and is recorded. */
  async function body<T>(
    ctx: Context,
    schema: z.ZodType<T>,
  ): Promise<{ readonly data: T } | { readonly reply: Reply }> {
    const parsed = schema.safeParse(await ctx.body());
    if (parsed.success) return { data: parsed.data };
    return { reply: { status: "invalid", issues: z.prettifyError(parsed.error) } };
  }

  function report(
    device: Device,
    payload: z.infer<typeof PlaybackReport>,
    phase: "start" | "progress" | "stop",
  ) {
    const target = item(payload.ItemId);
    if (target === undefined || !isVideo(target)) return empty(404);
    const data = state.data(device.userId, target.id);
    device.lastActivity = new Date().toISOString();
    if (phase === "start") {
      device.nowPlaying = {
        itemId: target.id,
        mediaSourceId: payload.MediaSourceId ?? undefined,
        playSessionId: payload.PlaySessionId ?? undefined,
        playMethod: payload.PlayMethod ?? "DirectPlay",
        positionTicks: payload.PositionTicks ?? 0,
        isPaused: payload.IsPaused ?? false,
        audioStreamIndex: payload.AudioStreamIndex ?? undefined,
        subtitleStreamIndex: payload.SubtitleStreamIndex ?? undefined,
      };
      startPlayState(data);
      return empty();
    }
    if (phase === "progress") {
      const now = device.nowPlaying;
      if (now?.itemId === target.id) {
        now.positionTicks = payload.PositionTicks ?? now.positionTicks;
        now.isPaused = payload.IsPaused ?? now.isPaused;
        now.audioStreamIndex = payload.AudioStreamIndex ?? undefined;
        now.subtitleStreamIndex = payload.SubtitleStreamIndex ?? undefined;
      }
      if (payload.PositionTicks != null)
        updatePlayState(data, target.probed.runTimeTicks, payload.PositionTicks);
      return empty();
    }
    if (payload.Failed !== true) {
      if (payload.PositionTicks != null)
        updatePlayState(data, target.probed.runTimeTicks, payload.PositionTicks);
      else {
        data.playCount += 1;
        data.played = true;
        data.playbackPositionTicks = 0;
      }
    }
    if (device.nowPlaying?.itemId === target.id) device.nowPlaying = undefined;
    return empty();
  }

  function sendFile(ctx: Context, file: string, type: string): Reply {
    const size = statSync(file).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(ctx.request.headers["range"] ?? "");
    const head = ctx.method === "HEAD";
    if (range === null) {
      ctx.response.writeHead(200, {
        "Content-Type": type,
        "Content-Length": size,
        "Accept-Ranges": "bytes",
      });
      if (head) ctx.response.end();
      else createReadStream(file).pipe(ctx.response);
      return { status: "sent" };
    }
    const [, from, to] = range;
    const start = from === "" ? Math.max(0, size - Number(to)) : Number(from);
    const end = from === "" || to === "" ? size - 1 : Math.min(Number(to), size - 1);
    if (start >= size || start > end) {
      ctx.response.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
      return { status: "sent" };
    }
    ctx.response.writeHead(206, {
      "Content-Type": type,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
    });
    if (head) ctx.response.end();
    else createReadStream(file, { start, end }).pipe(ctx.response);
    return { status: "sent" };
  }

  const authResult = (
    device: Device,
    user: NonNullable<ReturnType<typeof state.user>>,
    remote: string | undefined,
  ) => ({
    User: userDto(user),
    SessionInfo: sessionDto(state, library, device, remote),
    AccessToken: device.token,
    ServerId: SERVER_ID,
  });
  const remoteOf = (ctx: Context) => ctx.request.socket.remoteAddress ?? "127.0.0.1";

  const routes: Route[] = [
    {
      method: "GET",
      pattern: path("/System/Info/Public"),
      auth: "none",
      handle: () =>
        json({
          LocalAddress: url.replace(/\/$/, ""),
          ServerName: serverName,
          Version: SERVER_VERSION,
          ProductName: "Jellyfin Server",
          OperatingSystem: "",
          Id: SERVER_ID,
          StartupWizardCompleted: true,
        }),
    },
    {
      method: "GET",
      pattern: path("/Users/Public"),
      auth: "none",
      handle: () => json(state.users.filter((u) => !u.isHidden).map(publicUserDto)),
    },
    {
      method: "POST",
      pattern: path("/Users/AuthenticateByName"),
      auth: "none",
      handle: async (ctx) => {
        const client = fullClient(ctx.auth);
        if (client === undefined) return empty(400);
        const parsedCreds = await body(ctx, Credentials);
        if ("reply" in parsedCreds) return parsedCreds.reply;
        const creds = parsedCreds.data;
        const user = state.userByName(creds.Username);
        if (user === undefined || user.password !== (creds.Pw ?? ""))
          return json("Error processing request.", 401);
        return json(authResult(state.signIn(user, client), user, remoteOf(ctx)));
      },
    },
    {
      method: "GET",
      pattern: path("/QuickConnect/Enabled"),
      auth: "none",
      handle: () => json(state.quickConnectEnabled),
    },
    {
      method: "POST",
      pattern: path("/QuickConnect/Initiate"),
      auth: "none",
      handle: (ctx) => {
        const client = fullClient(ctx.auth);
        if (client === undefined) return empty(400);
        if (!state.quickConnectEnabled) return empty(401);
        return json(quickConnectDto(state.initiateQuickConnect(client)));
      },
    },
    {
      method: "GET",
      pattern: path("/QuickConnect/Connect"),
      auth: "none",
      handle: (ctx) => {
        const request = state.quickConnect.get(ctx.query.get("secret")?.[0] ?? "");
        return request === undefined ? empty(404) : json(quickConnectDto(request));
      },
    },
    {
      method: "POST",
      pattern: path("/QuickConnect/Authorize"),
      auth: "user",
      handle: (ctx) => {
        const code = ctx.query.get("code")?.[0];
        const request = [...state.quickConnect.values()].find((r) => r.code === code);
        if (request === undefined) return empty(404);
        request.authorizedUserId = state.user(
          ctx.query.get("userid")?.[0] ?? ctx.device?.userId ?? "",
        )?.id;
        return json(request.authorizedUserId !== undefined);
      },
    },
    {
      method: "POST",
      pattern: path("/Users/AuthenticateWithQuickConnect"),
      auth: "none",
      handle: async (ctx) => {
        const client = fullClient(ctx.auth);
        if (client === undefined) return empty(400);
        const parsedPayload = await body(ctx, QuickConnectSecret);
        if ("reply" in parsedPayload) return parsedPayload.reply;
        const payload = parsedPayload.data;
        const request = state.quickConnect.get(payload.Secret);
        const user = state.user(request?.authorizedUserId ?? "");
        if (request === undefined || user === undefined) return empty(400);
        state.quickConnect.delete(payload.Secret);
        return json(authResult(state.signIn(user, client), user, undefined));
      },
    },
    {
      method: "GET",
      pattern: path("/Users/Me"),
      auth: "user",
      handle: (ctx) => {
        const user = state.user(ctx.device?.userId ?? "");
        return user === undefined ? empty(401) : json(userDto(user));
      },
    },
    {
      method: "GET",
      pattern: path("/Users/{userId}"),
      auth: "user",
      handle: (ctx) => {
        const user = state.user(ctx.params[0] ?? "");
        return user === undefined ? empty(404) : json(userDto(user));
      },
    },
    {
      method: "GET",
      pattern: path("/UserViews"),
      auth: "user",
      handle: (ctx) => json(queryResult(render(ctx, library.views))),
    },
    { method: "GET", pattern: path("/Items/Latest"), auth: "user", handle: latest },
    { method: "GET", pattern: path("/UserItems/Resume"), auth: "user", handle: resume },
    { method: "GET", pattern: path("/Shows/NextUp"), auth: "user", handle: nextUp },
    { method: "GET", pattern: path("/Items"), auth: "user", handle: itemsQuery },
    {
      method: "GET",
      pattern: path("/Genres"),
      auth: "user",
      handle: (ctx) => {
        const wanted = types(ctx);
        const names = new Set(
          [...library.items.values()]
            .filter((i) => ofTypes(wanted, i))
            .flatMap((i) =>
              i.type === "Movie" ? i.genres : i.type === "Series" ? i.meta.genres : [],
            ),
        );
        const genres = [...names].toSorted().map((name) => ({
          Name: name,
          ServerId: SERVER_ID,
          Id: genreId(name),
          Type: "Genre",
          ImageTags: {},
          BackdropImageTags: [],
          LocationType: "FileSystem",
          MediaType: "Unknown",
        }));
        return json(queryResult(page(ctx, genres), genres.length));
      },
    },
    {
      method: "GET",
      pattern: path("/Items/{itemId}"),
      auth: "user",
      handle: (ctx) => {
        const found = item(ctx.params[0]);
        return found === undefined
          ? empty(404)
          : json(baseItem(state, library, userOf(ctx)?.id, found, ALL_FIELDS));
      },
    },
    {
      method: "GET",
      pattern: path("/Shows/{seriesId}/Seasons"),
      auth: "user",
      handle: (ctx) => {
        const series = item(ctx.params[0]);
        if (series?.type !== "Series") return empty(404);
        const seasons = series.seasonIds.map((id) => itemOf(library.items, id, "Season"));
        // The seasons route adds the aspect ratio unasked, as Jellyfin's does.
        const o = dtoOptions(ctx);
        const fields =
          o.fields === "all" ? o.fields : new Set([...o.fields, "primaryimageaspectratio"]);
        return json(queryResult(render(ctx, seasons, { ...o, fields })));
      },
    },
    { method: "GET", pattern: path("/Shows/{seriesId}/Episodes"), auth: "user", handle: episodes },
    {
      method: "POST",
      pattern: path("/Items/{itemId}/PlaybackInfo"),
      auth: "user",
      handle: async (ctx) => {
        const found = item(ctx.params[0]);
        if (found === undefined || !isVideo(found)) return empty(404);
        const parsedPayload = await body(ctx, PlaybackInfoBody);
        if ("reply" in parsedPayload) return parsedPayload.reply;
        const payload = parsedPayload.data;
        const device = caller(ctx);
        return json(playbackInfo(found, payload, device.token, device.deviceId));
      },
    },
    {
      method: "GET",
      pattern: path("/UserItems/{itemId}/UserData"),
      auth: "user",
      handle: (ctx) => {
        const found = item(ctx.params[0]);
        const user = userOf(ctx);
        if (found === undefined || user === undefined) return empty(404);
        return json(userItemData(state.data(user.id, found.id), found.id, runtime(found)));
      },
    },
    {
      method: "POST",
      pattern: path("/UserItems/{itemId}/UserData"),
      auth: "user",
      handle: async (ctx) => {
        const found = item(ctx.params[0]);
        const user = userOf(ctx);
        if (found === undefined || user === undefined) return empty(404);
        const parsedUpdate = await body(ctx, UpdateUserData);
        if ("reply" in parsedUpdate) return parsedUpdate.reply;
        const update = parsedUpdate.data;
        const data = state.data(user.id, found.id);
        if (update.PlaybackPositionTicks != null)
          data.playbackPositionTicks = update.PlaybackPositionTicks;
        if (update.PlayCount != null) data.playCount = update.PlayCount;
        if (update.IsFavorite != null) data.isFavorite = update.IsFavorite;
        if (update.Played != null) data.played = update.Played;
        if (update.LastPlayedDate !== undefined)
          data.lastPlayedDate = update.LastPlayedDate ?? undefined;
        return json(userItemData(data, found.id, runtime(found)));
      },
    },
    ...(["POST", "DELETE"] as const).map((method): Route => ({
      method,
      pattern: path("/UserPlayedItems/{itemId}"),
      auth: "user",
      handle: (ctx) => {
        const found = item(ctx.params[0]);
        const user = userOf(ctx);
        if (found === undefined || user === undefined) return empty(404);
        const data = state.data(user.id, found.id);
        data.played = method === "POST";
        data.playbackPositionTicks = 0;
        if (method === "POST") {
          data.playCount += 1;
          data.lastPlayedDate = new Date().toISOString();
        } else {
          // BaseItem.ResetPlayedState.
          data.playCount = 0;
          data.lastPlayedDate = undefined;
        }
        return json(userItemData(data, found.id, runtime(found)));
      },
    })),
    ...(
      [
        ["/Sessions/Playing", "start"],
        ["/Sessions/Playing/Progress", "progress"],
        ["/Sessions/Playing/Stopped", "stop"],
      ] as const
    ).map(([template, phase]): Route => ({
      method: "POST",
      pattern: path(template),
      auth: "user",
      handle: async (ctx) => {
        const parsedPayload = await body(ctx, PlaybackReport);
        if ("reply" in parsedPayload) return parsedPayload.reply;
        const payload = parsedPayload.data;
        return report(caller(ctx), payload, phase);
      },
    })),
    {
      method: "GET",
      pattern: path("/Sessions"),
      auth: "user",
      handle: (ctx) => {
        const deviceId = ctx.query.get("deviceid")?.[0];
        const self = caller(ctx);
        const admin = state.user(self.userId)?.isAdministrator === true;
        const sessions = [...state.devices.values()]
          .filter((d) => deviceId === undefined || d.deviceId === deviceId)
          .filter((d) => admin || d.userId === self.userId)
          .map((d) => sessionDto(state, library, d, remoteOf(ctx)));
        return json(sessions);
      },
    },
    {
      method: "POST",
      pattern: path("/Sessions/Logout"),
      auth: "user",
      handle: (ctx) => {
        state.revoke(caller(ctx).deviceId);
        return empty();
      },
    },
    {
      method: "GET",
      pattern: path("/Devices"),
      auth: "admin",
      handle: () => json(queryResult([...state.devices.values()].map((d) => deviceDto(state, d)))),
    },
    {
      method: "DELETE",
      pattern: path("/Devices"),
      auth: "admin",
      handle: (ctx) => (state.revoke(ctx.query.get("id")?.[0] ?? "") ? empty() : empty(404)),
    },
    ...(["GET", "HEAD"] as const).flatMap((method): Route[] =>
      [path("/Videos/{itemId}/stream"), path("/Videos/{itemId}/stream\\.([a-z0-9]+)")].map(
        (pattern): Route => ({
          method,
          pattern,
          // Jellyfin serves streams, subtitles and images to anyone who has the item id.
          auth: "none",
          handle: (ctx) => {
            const found = item(ctx.params[0]);
            if (found === undefined || !isVideo(found)) return empty(404);
            return sendFile(
              ctx,
              found.file,
              CONTENT_TYPE[extname(found.file)] ?? "application/octet-stream",
            );
          },
        }),
      ),
    ),
    {
      method: "GET",
      pattern: path("/Videos/{itemId}/{mediaSourceId}/Subtitles/{index}/{ticks}/Stream\\.([a-z]+)"),
      auth: "none",
      handle: (ctx) => {
        const found = item(ctx.params[0]);
        if (found === undefined || !isVideo(found)) return empty(404);
        const index = Number(ctx.params[2]);
        const file = found.probed.sidecars.get(index);
        const stream = found.probed.streams.find((s) => s.Index === index);
        // Only sidecars in their own format are served; Jellyfin would extract or convert the rest.
        if (
          file === undefined ||
          stream === undefined ||
          stream.Codec.toLowerCase() !== ctx.params[4]?.toLowerCase()
        )
          return empty(404);
        if (stream.Codec === "subrip") {
          ctx.response.writeHead(200, { "Content-Type": "application/octet-stream" });
          ctx.response.end(rewriteSrt(readFileSync(file, "utf8")));
          return { status: "sent" };
        }
        return sendFile(ctx, file, CONTENT_TYPE[extname(file)] ?? "application/octet-stream");
      },
    },
    ...[path("/Items/{itemId}/Images/{type}"), path("/Items/{itemId}/Images/{type}/{index}")].map(
      (pattern): Route => ({
        method: "GET",
        pattern,
        auth: "none",
        handle: (ctx) => {
          const found = item(ctx.params[0]);
          const type = (["Primary", "Backdrop", "Logo", "Thumb"] as const).find(
            (t) => t.toLowerCase() === ctx.params[1]?.toLowerCase(),
          );
          const image = type === undefined ? undefined : found?.images[type];
          if (image === undefined || Number(ctx.params[2] ?? 0) !== 0) return empty(404);
          ctx.response.writeHead(200, { "Content-Type": "image/png" });
          ctx.response.end(readFileSync(image.file));
          return { status: "sent" };
        },
      }),
    ),
  ];

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      unexpected.push(`${request.method} ${request.url}: ${String(error)}`);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const parsed = new URL(request.url ?? "/", "http://fake");
    const method = request.method ?? "GET";
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    requests.push(`${method} ${parsed.pathname}`);
    const query = parseQuery(parsed);
    const auth = parseAuth(request, query);
    let route: Route | undefined;
    let params: string[] = [];
    for (const candidate of routes) {
      const found = candidate.method === method ? candidate.pattern.exec(parsed.pathname) : null;
      if (found) {
        route = candidate;
        params = found.slice(1).map(decodeURIComponent);
        break;
      }
    }
    if (route === undefined) {
      unexpected.push(`${method} ${parsed.pathname}${parsed.search}`);
      response.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found");
      return;
    }
    const device = auth.token === undefined ? undefined : state.byToken(auth.token);
    if (route.auth !== "none" && device === undefined) {
      response.writeHead(401).end();
      return;
    }
    if (route.auth === "admin" && state.user(device?.userId ?? "")?.isAdministrator !== true) {
      response.writeHead(403).end();
      return;
    }
    if (device !== undefined) device.lastActivity = new Date().toISOString();
    let raw: Promise<unknown> | undefined;
    const ctx: Context = {
      method,
      path: parsed.pathname,
      params,
      query,
      auth,
      device,
      request,
      response,
      body: () => (raw ??= readJson(request)),
    };
    const result = await route.handle(ctx);
    if (result.status === "sent") return;
    if (result.status === "invalid") {
      unexpected.push(`${method} ${parsed.pathname}: invalid body\n${result.issues}`);
      response.writeHead(400, { "Content-Type": "text/plain" }).end(result.issues);
      return;
    }
    if (result.json === undefined) {
      response.writeHead(result.status).end();
      return;
    }
    const text = JSON.stringify(result.json);
    response.writeHead(result.status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(text);
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const bound: string | AddressInfo | null = server.address();
  if (bound === null || typeof bound === "string") throw new Error("The fake is not on a TCP port");
  const address = `127.0.0.1:${bound.port}`;
  url = `http://${address}/`;

  let udp: Socket | undefined;
  if (options.discovery !== undefined) {
    const { address: host, port = 7359 } = options.discovery;
    const socket = createSocket("udp4");
    socket.on("message", (message, from) => {
      if (!message.toString("utf8").toLowerCase().includes("who is jellyfinserver?")) return;
      const answer = {
        Address: url.replace(/\/$/, ""),
        Id: SERVER_ID,
        Name: serverName,
        EndpointAddress: null,
      };
      socket.send(JSON.stringify(answer), from.port, from.address);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(port, host, () => {
        socket.off("error", reject);
        resolve();
      });
    });
    udp = socket;
  }

  return {
    url,
    address,
    serverName,
    state,
    library,
    requests,
    unexpected,
    itemId: (entryId) => library.byEntry.get(entryId),
    close: async () => {
      udp?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function quickConnectDto(request: ReturnType<FakeState["initiateQuickConnect"]>) {
  return {
    Authenticated: request.authorizedUserId !== undefined,
    Secret: request.secret,
    Code: request.code,
    DeviceId: request.deviceId,
    DeviceName: request.device,
    AppName: request.client,
    AppVersion: request.version,
    DateAdded: request.dateAdded,
  };
}

/** Jellyfin parses a SubRip file and writes it back: renumbered cues, each followed by a blank line. */
export function rewriteSrt(text: string): string {
  return text
    .replaceAll("\r\n", "\n")
    .split(/\n{2,}/)
    .map((block) => block.split("\n").filter((line) => line !== ""))
    .filter((lines) => lines.some((line) => line.includes("-->")))
    .map((lines, n) => {
      const timing = lines.findIndex((line) => line.includes("-->"));
      return `${[String(n + 1), ...lines.slice(timing)].join("\n")}\n\n`;
    })
    .join("");
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
