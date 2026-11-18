import { z } from "zod";

import { CATALOG, entryPath } from "./catalog";
import type { Entry } from "./catalog";
import { readManifest } from "./generate";

/**
 * Checks a real Jellyfin scan of the generated corpus against the catalog: for every built entry,
 * the server's VideoRangeType, DvProfile, video codec, each audio track's Codec, Profile and
 * Channels, the subtitle counts and the runtime. Fails loudly when the server is unreachable.
 *
 * The server must mount the corpus `movies` and `shows` dirs as its two libraries
 * (dev/jellyfin/jellyfin.sh does).
 */

const Stream = z.object({
  Type: z.string(),
  Index: z.number(),
  Codec: z.string().nullish(),
  Profile: z.string().nullish(),
  Channels: z.number().nullish(),
  VideoRangeType: z.string().nullish(),
  DvProfile: z.number().nullish(),
  IsExternal: z.boolean().nullish(),
});

const Item = z.object({
  Id: z.string(),
  Name: z.string(),
  Type: z.string(),
  Path: z.string().nullish(),
  RunTimeTicks: z.number().nullish(),
  MediaSources: z.array(z.object({ MediaStreams: z.array(Stream).nullish() })).nullish(),
});

type Item = z.infer<typeof Item>;

const Items = z.object({ Items: z.array(Item) });
const Auth = z.object({ AccessToken: z.string(), User: z.object({ Id: z.string() }) });

export interface Row {
  readonly id: string;
  readonly field: string;
  readonly declared: string;
  readonly observed: string;
  readonly ok: boolean;
}

const show = (v: string | number | null | undefined) =>
  v === null || v === undefined ? "null" : String(v);

/** Compares one entry with the server's item; every field becomes a row. */
export function compare(entry: Entry, item: Item | undefined): Row[] {
  const row = (
    field: string,
    declared: string | number | null | undefined,
    observed: string | number | null | undefined
  ): Row => ({
    id: entry.id,
    field,
    declared: show(declared),
    observed: show(observed),
    ok: show(declared) === show(observed),
  });

  if (!item) {
    return [row("item", entryPath(entry), "not found on the server")];
  }

  const streams = (item.MediaSources?.[0]?.MediaStreams ?? []).toSorted(
    (a, b) => a.Index - b.Index
  );

  const video = streams.find((s) => s.Type === "Video");
  const audio = streams.filter((s) => s.Type === "Audio");
  const subs = streams.filter((s) => s.Type === "Subtitle");
  const want = entry.expect;
  const seconds = (item.RunTimeTicks ?? 0) / 1e7;

  const rows = [
    row("type", entry.kind === "movie" ? "Movie" : "Episode", item.Type),
    row("video.Codec", want.video.codec, video?.Codec),
    row("video.VideoRangeType", want.video.range, video?.VideoRangeType),
    row("video.DvProfile", want.video.dvProfile, video?.DvProfile),
    row("audio.count", want.audio.length, audio.length),
    ...want.audio.flatMap((a, i) => [
      row(`audio[${i}].Codec`, a.codec, audio[i]?.Codec),
      row(`audio[${i}].Profile`, a.profile, audio[i]?.Profile),
      row(`audio[${i}].Channels`, a.channels, audio[i]?.Channels),
    ]),
    row("subtitles.embedded", want.subtitles.embedded, subs.filter((s) => !s.IsExternal).length),
    row("subtitles.external", want.subtitles.external, subs.filter((s) => s.IsExternal).length),
  ];

  // Runtime within a second: the long items must land in the 6-20 min window the tests use.
  rows.push({
    id: entry.id,
    field: "runtime.s",
    declared: String(entry.seconds),
    observed: seconds.toFixed(3),
    ok: Math.abs(seconds - entry.seconds) <= 1,
  });

  return rows;
}

export interface ClassifyOptions {
  readonly corpus: string;
  readonly server: string | undefined;
  /** Poll this long for the scan to reach every entry before comparing (0: compare at once). */
  readonly waitSeconds: number;
  readonly log: (line: string) => void;
}

export async function classifyCorpus(options: ClassifyOptions): Promise<number> {
  const { env } = process;

  const base =
    options.server ?? env.JELLYFIN_DEV_URL ?? `http://127.0.0.1:${env.JELLYFIN_DEV_PORT ?? "8096"}`;

  const user = env.JELLYFIN_DEV_USER ?? "harakiri";
  const password = env.JELLYFIN_DEV_PASSWORD ?? "harakiri-dev";
  const client = `MediaBrowser Client="harakiri-dev", Device="corpus-classify", DeviceId="harakiri-dev-corpus-classify", Version="0"`;

  async function call(path: string, init: RequestInit & { token?: string } = {}): Promise<unknown> {
    const auth = init.token ? `${client}, Token="${init.token}"` : client;
    let response: Response;

    try {
      response = await fetch(new URL(path, base), {
        ...init,
        headers: { Authorization: auth, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new Error(
        `Jellyfin is unreachable at ${base} (${error instanceof Error ? error.message : String(error)}). ` +
          `Start it with: mise run jellyfin:up`,
        { cause: error }
      );
    }

    if (!response.ok) {
      throw new Error(`${init.method ?? "GET"} ${path}: HTTP ${response.status}`);
    }

    return await response.json();
  }

  const manifest = readManifest(options.corpus);
  const built = new Set(manifest.entries.map((e) => e.id));
  const entries = CATALOG.filter((entry) => built.has(entry.id));
  options.log(
    `corpus ${options.corpus}: ${entries.length} entries` +
      (manifest.fate ? " (FATE tier included)" : " (FATE tier NOT built)")
  );

  await call("System/Info/Public");

  const auth = Auth.parse(
    await call("Users/AuthenticateByName", {
      method: "POST",
      body: JSON.stringify({ Username: user, Pw: password }),
    })
  );

  const query = new URLSearchParams({
    userId: auth.User.Id,
    Recursive: "true",
    IncludeItemTypes: "Movie,Episode",
    Fields: "MediaSources,Path",
    EnableImages: "false",
    EnableUserData: "false",
  });

  // Match on the path below the library root: the corpus `movies` and `shows` dirs are mounted
  // somewhere in the container, but everything under them is the corpus's own layout.
  const tail = (entry: Entry) => `/${entryPath(entry).split("/").slice(1).join("/")}`;

  const lookup = (items: readonly Item[]) =>
    new Map(entries.map((entry) => [entry.id, items.find((i) => i.Path?.endsWith(tail(entry)))]));

  const probed = (item: Item | undefined) =>
    (item?.MediaSources?.[0]?.MediaStreams ?? []).some((s) => s.Type === "Video");

  const t0 = performance.now();
  let found = lookup([]);

  for (;;) {
    found = lookup(
      Items.parse(await call(`Items?${query.toString()}`, { token: auth.AccessToken })).Items
    );
    const ready = entries.filter((entry) => probed(found.get(entry.id))).length;
    const elapsed = (performance.now() - t0) / 1000;

    if (ready === entries.length || elapsed >= options.waitSeconds) {
      options.log(
        `${ready}/${entries.length} entries probed by the server after ${elapsed.toFixed(1)}s`
      );
      break;
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  await call("Sessions/Logout", { method: "POST", token: auth.AccessToken }).catch(() => undefined);

  const rows = entries.flatMap((entry) => compare(entry, found.get(entry.id)));
  const bad = rows.filter((r) => !r.ok);
  options.log("\n| entry | field | declared | Jellyfin | ok |\n| --- | --- | --- | --- | --- |");

  for (const r of rows) {
    options.log(
      `| ${r.id} | ${r.field} | ${r.declared} | ${r.observed} | ${r.ok ? "yes" : "**NO**"} |`
    );
  }
  options.log(
    bad.length === 0
      ? `\nPASS: ${rows.length} checks on ${entries.length} entries match the catalog`
      : `\nFAIL: ${bad.length} of ${rows.length} checks differ:\n${bad.map((r) => `  ${r.id} ${r.field}: declared ${r.declared}, Jellyfin ${r.observed}`).join("\n")}`
  );

  return bad.length === 0 ? 0 : 1;
}
