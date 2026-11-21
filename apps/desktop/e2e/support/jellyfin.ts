import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  authenticate,
  authorizationHeader,
  DeviceId,
  ItemId,
  MediaSourceId,
} from "@harakiri/jellyfin";
import type { ClientIdentity, ServerUrl, SessionData } from "@harakiri/jellyfin";
import { z } from "zod";

import { CATALOG, entryPath } from "../../../../packages/harness/src/corpus/catalog";
import type { Entry } from "../../../../packages/harness/src/corpus/catalog";
import { clientIdentity } from "../../src/shared/identity";
import { CORPUS_DIR } from "./backend";
import type { Backend } from "./backend";

export const TICKS_PER_SECOND = 10_000_000;

const { version } = z
  .object({ version: z.string() })
  .parse(
    JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf-8"))
  );

/**
 * The identity the app itself sends, version included (the bundles get it at build time, so
 * `clientIdentity` alone would say 0.0.0-dev here). Seeded profiles run the app on the worker's
 * device id, so the server sees one client on that device, never two fighting over it.
 */
const appIdentity = (deviceId: DeviceId): ClientIdentity => ({
  ...clientIdentity(deviceId),
  version,
});

/**
 * Signs in once per run with a fresh UUID device id (main rejects a device-id file that is not a
 * UUID, and Jellyfin keeps one token per device id).
 */
export const signInAccount = async (backend: Backend): Promise<SessionData> => {
  const result = await authenticate(
    backend.server,
    backend.user,
    backend.password,
    appIdentity(DeviceId.parse(randomUUID()))
  );

  if (result.kind !== "signed-in") {
    throw new Error(
      `Signing in to the Jellyfin at ${backend.server} failed: ${JSON.stringify(result)}`
    );
  }

  return result.session;
};

/**
 * Writes the files main's session store reads (apps/desktop/src/main/session.ts): `session.json`
 * with the token `obfuscated`, as the store keeps it where there is no keyring, and `device-id`.
 * session.spec.ts proves the app reads this format back and writes it itself.
 */
export const seedSession = (userDataDir: string, session: SessionData): void => {
  const { accessToken, deviceId, ...rest } = session;
  writeFileSync(
    path.join(userDataDir, "session.json"),
    JSON.stringify({
      ...rest,
      token: { kind: "obfuscated", base64: Buffer.from(accessToken).toString("base64") },
    }),
    { mode: 0o600 }
  );
  writeFileSync(path.join(userDataDir, "device-id"), deviceId, { mode: 0o600 });
};

/** How onboarding lists a discovered server: its name, then its address. */
export const serverEntryName = async (backend: Backend): Promise<string> => {
  const { name } = await publicInfo(backend.server);

  return `${name}, ${backend.server}`;
};

/** What the server says about itself before sign-in: the name and version onboarding shows. */
export const publicInfo = async (
  server: ServerUrl
): Promise<{ name: string; version: string; id: string }> => {
  const response = await fetch(new URL("System/Info/Public", server));

  const info = z
    .object({ ServerName: z.string(), Version: z.string(), Id: z.string() })
    .parse(await response.json());

  return { name: info.ServerName, version: info.Version, id: info.Id };
};

const Stream = z.object({
  Type: z.string(),
  Index: z.number().int(),
  Codec: z.string().nullish(),
  Profile: z.string().nullish(),
  VideoRangeType: z.string().nullish(),
  DvProfile: z.number().nullish(),
});

type Stream = z.infer<typeof Stream>;

const Item = z.object({
  Id: z.string(),
  Name: z.string(),
  Type: z.string(),
  Path: z.string().nullish(),
  RunTimeTicks: z.number().nullish(),
  MediaSources: z
    .array(z.object({ Id: z.string(), MediaStreams: z.array(Stream).default([]) }))
    .default([]),
});

/** The resume state a test may disturb, all of it writable back through UpdateUserItemData. */
const UserData = z.object({
  PlaybackPositionTicks: z.number().int(),
  Played: z.boolean(),
  PlayCount: z.number().int().nullish(),
  LastPlayedDate: z.string().nullish(),
});

export type UserData = z.infer<typeof UserData>;

const ServerSession = z.object({
  DeviceId: z.string(),
  NowPlayingItem: z.object({ Id: z.string() }).nullish(),
  PlayState: z
    .object({
      PositionTicks: z.number().nullish(),
      IsPaused: z.boolean().nullish(),
      PlayMethod: z.string().nullish(),
    })
    .nullish(),
});

export type ServerSession = z.infer<typeof ServerSession>;

/** An item as the library screens show it: the fields their labels and progress are built from. */
const ShownItem = z.object({
  Id: z.string(),
  Name: z.string(),
  Type: z.string(),
  SeriesName: z.string().nullish(),
  IndexNumber: z.number().nullish(),
  ParentIndexNumber: z.number().nullish(),
  RunTimeTicks: z.number().nullish(),
  UserData: z
    .object({ PlaybackPositionTicks: z.number(), PlayedPercentage: z.number().nullish() })
    .nullish(),
});

export type ShownItem = z.infer<typeof ShownItem>;

const TICKS_PER_MINUTE = 60 * TICKS_PER_SECOND;

const pad2 = (n: number | null | undefined) => String(n ?? 0).padStart(2, "0");

/** How a card or title names an item before its catalogue number: "Series, S01 E02, Episode" or the title. */
export const spokenTitle = (item: ShownItem): string =>
  item.Type === "Episode" && item.SeriesName !== undefined && item.SeriesName !== null
    ? `${item.SeriesName}, S${pad2(item.ParentIndexNumber)} E${pad2(item.IndexNumber)}, ${item.Name}`
    : item.Name;

/** "N min left" exactly as the renderer computes it (apps/desktop/src/renderer/src/data/entry.ts). */
export const minutesLeft = (item: ShownItem): number | null => {
  const percent = item.UserData?.PlayedPercentage ?? null;

  const runTimeTicks = item.RunTimeTicks ?? null;

  if (percent === null || percent <= 0 || percent >= 100 || runTimeTicks === null) {
    return null;
  }

  const minutes = Math.round(runTimeTicks / TICKS_PER_MINUTE);

  return Math.max(1, Math.round(minutes * (1 - percent / 100)));
};

export type ItemType = "Movie" | "Episode";

/**
 * What a test needs from the library, matched against the first media source's streams. On the
 * corpus server, `corpus` names the catalog entries that satisfy it (packages/harness/src/corpus);
 * on another server, the library is searched by the criteria.
 */
export interface ItemCriteria {
  readonly label: string;
  readonly corpus: readonly string[];
  readonly types: readonly ItemType[];
  readonly minutes?: readonly [min: number, max: number];
  readonly video?: {
    readonly codec?: string;
    readonly ranges?: readonly string[];
    readonly dvProfile?: number;
  };
  /** Picks the first audio stream that matches; the test plays that stream explicitly. */
  readonly audio?: { readonly codec: string; readonly atmos?: boolean };
}

export interface PickedItem {
  readonly id: ItemId;
  readonly name: string;
  readonly mediaSourceId: MediaSourceId;
  readonly runTimeTicks: number;
  readonly video: Stream;
  readonly audio: Stream | undefined;
}

export const ITEMS = {
  sdrH264Short: {
    label: "an SDR H.264 item of 6 to 20 minutes",
    corpus: ["sdr-h264-eac3-long", "sdr-h264-aac-long"],
    types: ["Movie", "Episode"],
    minutes: [6, 20],
    video: { codec: "h264", ranges: ["SDR"] },
  },
  eac3: {
    label: "an SDR H.264 item with a non-Atmos E-AC3 track",
    corpus: ["sdr-h264-eac3-long"],
    types: ["Movie", "Episode"],
    minutes: [6, 60],
    video: { codec: "h264", ranges: ["SDR"] },
    audio: { codec: "eac3", atmos: false },
  },
  truehdAtmos: {
    label: "a film with a TrueHD Atmos track",
    corpus: ["fate-truehd-atmos"],
    types: ["Movie"],
    audio: { codec: "truehd", atmos: true },
  },
  dvP5: {
    label: "a Dolby Vision profile 5 episode",
    corpus: ["dv-p5-hevc-episode"],
    types: ["Episode"],
    video: { dvProfile: 5 },
  },
  hdr10: {
    label: "an HDR10 film",
    corpus: ["hdr10-hevc"],
    types: ["Movie"],
    video: { ranges: ["HDR10"] },
  },
} as const satisfies Record<string, ItemCriteria>;

const isAtmos = (stream: Stream) => (stream.Profile ?? "").includes("Atmos");

const videoMatches = (video: Stream, wanted: ItemCriteria["video"]): boolean => {
  if (wanted?.codec !== undefined && video.Codec !== wanted.codec) {
    return false;
  }

  if (wanted?.ranges && !wanted.ranges.includes(video.VideoRangeType ?? "")) {
    return false;
  }

  return wanted?.dvProfile === undefined || video.DvProfile === wanted.dvProfile;
};

const matchItem = (item: z.infer<typeof Item>, criteria: ItemCriteria): PickedItem | undefined => {
  if (!criteria.types.some((type) => type === item.Type)) {
    return undefined;
  }

  const runTimeTicks = item.RunTimeTicks ?? 0;
  const minutes = runTimeTicks / TICKS_PER_SECOND / 60;

  if (criteria.minutes && (minutes < criteria.minutes[0] || minutes > criteria.minutes[1])) {
    return undefined;
  }

  const [source] = item.MediaSources;

  if (!source) {
    return undefined;
  }

  const video = source.MediaStreams.find((stream) => stream.Type === "Video");

  if (!video) {
    return undefined;
  }

  if (!videoMatches(video, criteria.video)) {
    return undefined;
  }

  const audioWanted = criteria.audio;

  const audio = audioWanted
    ? source.MediaStreams.find(
        (stream) =>
          stream.Type === "Audio" &&
          stream.Codec === audioWanted.codec &&
          (audioWanted.atmos === undefined || isAtmos(stream) === audioWanted.atmos)
      )
    : undefined;

  if (audioWanted && !audio) {
    return undefined;
  }

  return {
    id: ItemId.parse(item.Id),
    name: item.Name,
    mediaSourceId: MediaSourceId.parse(source.Id),
    runTimeTicks,
    video,
    audio,
  };
};

/** Where jellyfin.sh mounts a corpus file in the container: shows/ is mounted as /media/series. */
const containerPath = (entry: Entry) =>
  `/media/${entryPath(entry).replace(/^shows\//u, "series/")}`;

const pickFromCorpus = (
  items: readonly z.infer<typeof Item>[],
  criteria: ItemCriteria,
  count: number
): PickedItem[] => {
  const wanted = criteria.corpus.slice(0, count);

  if (wanted.length < count) {
    throw new Error(`The corpus names ${wanted.length} of the ${count} wanted: ${criteria.label}`);
  }

  return wanted.map((entryId) => {
    const entry = CATALOG.find((candidate) => candidate.id === entryId);

    if (entry === undefined) {
      throw new Error(`The catalog has no "${entryId}"`);
    }

    const item = items.find((candidate) => candidate.Path === containerPath(entry));

    if (item === undefined) {
      throw new Error(
        entry.tier === "fate"
          ? `${criteria.label}: "${entryId}" is a FATE-tier corpus entry and ${CORPUS_DIR} was built without the FATE samples. Run mise run media:fetch-fate, then mise run media:gen (mise run e2e does both).`
          : `${criteria.label}: the server has no "${entryId}" from ${CORPUS_DIR}. Run mise run media:gen.`
      );
    }

    const picked = matchItem(item, criteria);

    if (picked === undefined) {
      throw new Error(`The corpus entry "${entryId}" is no longer ${criteria.label}`);
    }

    return picked;
  });
};

/** A typed view of the server state the e2e asserts on, as the signed-in test user. */
export class Jellyfin {
  readonly #auth: string;
  readonly #backend: Backend;
  readonly session: SessionData;

  constructor(session: SessionData, backend: Backend) {
    this.session = session;
    this.#backend = backend;
    this.#auth = authorizationHeader(appIdentity(session.deviceId), session.accessToken);
  }

  async #fetch(route: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(new URL(route, this.#backend.server), {
      ...init,
      headers: { Authorization: this.#auth, "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`${init.method ?? "GET"} ${route}: HTTP ${response.status}`);
    }

    return response;
  }

  async #get<Schema extends z.ZodType>(schema: Schema, route: string): Promise<z.infer<Schema>> {
    const response = await this.#fetch(route);

    return schema.parse(await response.json());
  }

  async userData(itemId: ItemId): Promise<UserData> {
    return await this.#get(UserData, `UserItems/${itemId}/UserData?userId=${this.session.userId}`);
  }

  async setUserData(itemId: ItemId, data: UserData): Promise<void> {
    await this.#fetch(`UserItems/${itemId}/UserData?userId=${this.session.userId}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Gives an item a resume point played just now, so it leads Continue Watching. */
  async seedResume(itemId: ItemId, seconds: number): Promise<void> {
    await this.setUserData(itemId, {
      PlaybackPositionTicks: seconds * TICKS_PER_SECOND,
      Played: false,
      PlayCount: 1,
      LastPlayedDate: new Date().toISOString(),
    });
  }

  /** The server's sessions for this run's device id: the app's playback reports land here. */
  async sessions(): Promise<ServerSession[]> {
    const all = await this.#get(
      z.array(ServerSession),
      `Sessions?deviceId=${this.session.deviceId}`
    );

    return all.filter((session) => session.DeviceId === this.session.deviceId);
  }

  async nowPlaying(): Promise<ServerSession | undefined> {
    const sessions = await this.sessions();

    return sessions.find((session) => session.NowPlayingItem);
  }

  /**
   * Library items matching `criteria`. On the corpus server, the catalog entries the criteria
   * name, found by path and checked against the criteria; on another server, shortest first, so
   * every run picks the same ones.
   */
  async pickItems(criteria: ItemCriteria, count: number): Promise<PickedItem[]> {
    const query = new URLSearchParams({
      userId: this.session.userId,
      Recursive: "true",
      IncludeItemTypes: criteria.types.join(","),
      Fields: "MediaSources,Path",
    });

    const { Items } = await this.#get(
      z.object({ Items: z.array(Item) }),
      `Items?${query.toString()}`
    );

    if (this.#backend.kind === "corpus") {
      return pickFromCorpus(Items, criteria, count);
    }

    const picked = Items.flatMap((item) => matchItem(item, criteria) ?? [])
      .toSorted((a, b) => a.runTimeTicks - b.runTimeTicks || a.id.localeCompare(b.id))
      .slice(0, count);

    if (picked.length < count) {
      throw new Error(`The library has ${picked.length} of the ${count} wanted: ${criteria.label}`);
    }

    return picked;
  }

  async pickItem(criteria: ItemCriteria): Promise<PickedItem> {
    const [item] = await this.pickItems(criteria, 1);

    if (!item) {
      throw new Error(`The library has no ${criteria.label}`);
    }

    return item;
  }

  async item(itemId: ItemId): Promise<ShownItem> {
    return await this.#get(ShownItem, `Items/${itemId}?userId=${this.session.userId}`);
  }

  /** Recently Added as the library requests it: films and series, newest first. */
  async latest(): Promise<ShownItem[]> {
    const query = new URLSearchParams({
      userId: this.session.userId,
      includeItemTypes: "Movie,Series",
      limit: "16",
    });

    return await this.#get(z.array(ShownItem), `Items/Latest?${query.toString()}`);
  }

  /** Continue Watching as the server orders it, most recently played first. */
  async resumeIds(): Promise<string[]> {
    const { Items } = await this.#get(
      z.object({ Items: z.array(z.object({ Id: z.string() })) }),
      `UserItems/Resume?userId=${this.session.userId}&mediaTypes=Video&limit=16`
    );

    return Items.map((item) => item.Id);
  }

  /** Approves a Quick Connect code as this user, as a phone signed in to the server would. */
  async authorizeQuickConnect(code: string): Promise<void> {
    const query = new URLSearchParams({ code, userId: this.session.userId });

    const response = await fetch(
      new URL(`QuickConnect/Authorize?${query.toString()}`, this.#backend.server),
      {
        method: "POST",
        headers: { Authorization: this.#auth },
      }
    );

    if (!response.ok) {
      throw new Error(`QuickConnect/Authorize: HTTP ${response.status}`);
    }
  }

  /** Forgets a device and revokes its token (admin only): how a test cleans up an app that signed in itself. */
  async deleteDevice(deviceId: string): Promise<void> {
    await this.#fetch(`Devices?id=${encodeURIComponent(deviceId)}`, { method: "DELETE" });
  }

  /** Every device id the server holds a token for. */
  async deviceIds(): Promise<string[]> {
    const { Items } = await this.#get(
      z.object({ Items: z.array(z.object({ Id: z.string() })) }),
      "Devices"
    );

    return Items.map((device) => device.Id);
  }

  async signOut(): Promise<void> {
    await this.#fetch("Sessions/Logout", { method: "POST" });
  }
}
