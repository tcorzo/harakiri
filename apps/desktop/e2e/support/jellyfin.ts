import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  authenticate,
  authorizationHeader,
  type ClientIdentity,
  DeviceId,
  ItemId,
  MediaSourceId,
  type ServerUrl,
  type SessionData,
} from "@harakiri/jellyfin";
import { z } from "zod";
import { CATALOG } from "../../../../packages/harness/src/corpus/catalog";
import { clientIdentity } from "../../src/shared/identity";
import { type Backend, CORPUS_DIR } from "./backend";

export const TICKS_PER_SECOND = 10_000_000;

const { version } = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8")));

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
export async function signInAccount(backend: Backend): Promise<SessionData> {
  const result = await authenticate(
    backend.server,
    backend.user,
    backend.password,
    appIdentity(DeviceId.parse(randomUUID())),
  );
  if (result.kind !== "signed-in") {
    throw new Error(
      `Signing in to the ${backend.kind} Jellyfin at ${backend.server} failed: ${JSON.stringify(result)}`,
    );
  }
  return result.session;
}

/**
 * Writes the files main's session store reads (apps/desktop/src/main/session.ts): `session.json`
 * with the token as a `plain` tagged value, which only HARAKIRI_E2E=1 accepts, and `device-id`.
 * session.spec.ts proves the app reads this format back.
 */
export function seedSession(userDataDir: string, session: SessionData): void {
  const { accessToken, deviceId, ...rest } = session;
  writeFileSync(
    join(userDataDir, "session.json"),
    JSON.stringify({ ...rest, token: { kind: "plain", value: accessToken } }),
    { mode: 0o600 },
  );
  writeFileSync(join(userDataDir, "device-id"), deviceId, { mode: 0o600 });
}

/** What the server says about itself before sign-in: the name and version onboarding shows. */
export async function publicInfo(
  server: ServerUrl,
): Promise<{ name: string; version: string; id: string }> {
  const response = await fetch(new URL("System/Info/Public", server));
  const info = z
    .object({ ServerName: z.string(), Version: z.string(), Id: z.string() })
    .parse(await response.json());
  return { name: info.ServerName, version: info.Version, id: info.Id };
}

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
export function spokenTitle(item: ShownItem): string {
  return item.Type === "Episode" && item.SeriesName != null
    ? `${item.SeriesName}, S${pad2(item.ParentIndexNumber)} E${pad2(item.IndexNumber)}, ${item.Name}`
    : item.Name;
}

/** "N min left" exactly as the renderer computes it (apps/desktop/src/renderer/src/data/entry.ts). */
export function minutesLeft(item: ShownItem): number | null {
  const percent = item.UserData?.PlayedPercentage ?? null;
  if (percent === null || percent <= 0 || percent >= 100 || item.RunTimeTicks == null) return null;
  const minutes = Math.round(item.RunTimeTicks / TICKS_PER_MINUTE);
  return Math.max(1, Math.round(minutes * (1 - percent / 100)));
}

export type ItemType = "Movie" | "Episode";

/**
 * What a test needs from the library, matched against the first media source's streams. Against
 * the fake, `corpus` names the catalog entries that satisfy it (packages/harness/src/corpus);
 * against a real server, the library is searched by the criteria.
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

function matchItem(item: z.infer<typeof Item>, criteria: ItemCriteria): PickedItem | undefined {
  if (!criteria.types.some((type) => type === item.Type)) return undefined;
  const runTimeTicks = item.RunTimeTicks ?? 0;
  const minutes = runTimeTicks / TICKS_PER_SECOND / 60;
  if (criteria.minutes && (minutes < criteria.minutes[0] || minutes > criteria.minutes[1]))
    return undefined;
  const [source] = item.MediaSources;
  if (!source) return undefined;
  const video = source.MediaStreams.find((stream) => stream.Type === "Video");
  if (!video) return undefined;
  const wanted = criteria.video;
  if (wanted?.codec !== undefined && video.Codec !== wanted.codec) return undefined;
  if (wanted?.ranges && !wanted.ranges.includes(video.VideoRangeType ?? "")) return undefined;
  if (wanted?.dvProfile !== undefined && video.DvProfile !== wanted.dvProfile) return undefined;
  const audioWanted = criteria.audio;
  const audio = audioWanted
    ? source.MediaStreams.find(
        (stream) =>
          stream.Type === "Audio" &&
          stream.Codec === audioWanted.codec &&
          (audioWanted.atmos === undefined || isAtmos(stream) === audioWanted.atmos),
      )
    : undefined;
  if (audioWanted && !audio) return undefined;
  return {
    id: ItemId.parse(item.Id),
    name: item.Name,
    mediaSourceId: MediaSourceId.parse(source.Id),
    runTimeTicks,
    video,
    audio,
  };
}

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

  async #request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(new URL(path, this.#backend.server), {
      ...init,
      headers: { Authorization: this.#auth, "Content-Type": "application/json" },
    });
    if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: HTTP ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  }

  async userData(itemId: ItemId): Promise<UserData> {
    return UserData.parse(
      await this.#request(`UserItems/${itemId}/UserData?userId=${this.session.userId}`),
    );
  }

  async setUserData(itemId: ItemId, data: UserData): Promise<void> {
    await this.#request(`UserItems/${itemId}/UserData?userId=${this.session.userId}`, {
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
    const all = z
      .array(ServerSession)
      .parse(await this.#request(`Sessions?deviceId=${this.session.deviceId}`));
    return all.filter((session) => session.DeviceId === this.session.deviceId);
  }

  async nowPlaying(): Promise<ServerSession | undefined> {
    return (await this.sessions()).find((session) => session.NowPlayingItem);
  }

  /**
   * Library items matching `criteria`. Against the fake, the catalog entries the criteria name,
   * checked against the criteria; against a real server, shortest first, so every run picks the
   * same ones.
   */
  async pickItems(criteria: ItemCriteria, count: number): Promise<PickedItem[]> {
    const fake = this.#backend.fake;
    if (fake !== undefined) return this.#pickFromCorpus(criteria, count, fake);
    const query = new URLSearchParams({
      userId: this.session.userId,
      Recursive: "true",
      IncludeItemTypes: criteria.types.join(","),
      Fields: "MediaSources",
    });
    const { Items } = z
      .object({ Items: z.array(Item) })
      .parse(await this.#request(`Items?${query.toString()}`));
    const picked = Items.flatMap((item) => matchItem(item, criteria) ?? [])
      .toSorted((a, b) => a.runTimeTicks - b.runTimeTicks || a.id.localeCompare(b.id))
      .slice(0, count);
    if (picked.length < count) {
      throw new Error(`The library has ${picked.length} of the ${count} wanted: ${criteria.label}`);
    }
    return picked;
  }

  async #pickFromCorpus(
    criteria: ItemCriteria,
    count: number,
    fake: NonNullable<Backend["fake"]>,
  ): Promise<PickedItem[]> {
    const wanted = criteria.corpus.slice(0, count);
    if (wanted.length < count) {
      throw new Error(
        `The corpus names ${wanted.length} of the ${count} wanted: ${criteria.label}`,
      );
    }
    const ids = wanted.map((entryId) => {
      const id = fake.itemId(entryId);
      if (id !== undefined) return id;
      const fate = CATALOG.find((entry) => entry.id === entryId)?.tier === "fate";
      throw new Error(
        fate
          ? `${criteria.label}: "${entryId}" is a FATE-tier corpus entry and ${CORPUS_DIR} was built without the FATE samples. Run mise run media:fetch-fate, then mise run media:gen (mise run e2e does both).`
          : `${criteria.label}: the corpus in ${CORPUS_DIR} has no "${entryId}". Run mise run media:gen.`,
      );
    });
    const query = new URLSearchParams({
      userId: this.session.userId,
      ids: ids.join(","),
      Fields: "MediaSources",
    });
    const { Items } = z
      .object({ Items: z.array(Item) })
      .parse(await this.#request(`Items?${query.toString()}`));
    return ids.map((id, i) => {
      const item = Items.find((candidate) => candidate.Id === id);
      const picked = item === undefined ? undefined : matchItem(item, criteria);
      if (picked === undefined) {
        throw new Error(`The corpus entry "${wanted[i]}" is no longer ${criteria.label}`);
      }
      return picked;
    });
  }

  async pickItem(criteria: ItemCriteria): Promise<PickedItem> {
    const [item] = await this.pickItems(criteria, 1);
    if (!item) throw new Error(`The library has no ${criteria.label}`);
    return item;
  }

  async item(itemId: ItemId): Promise<ShownItem> {
    return ShownItem.parse(await this.#request(`Items/${itemId}?userId=${this.session.userId}`));
  }

  /** Recently Added as the library requests it: films and series, newest first. */
  async latest(): Promise<ShownItem[]> {
    const query = new URLSearchParams({
      userId: this.session.userId,
      includeItemTypes: "Movie,Series",
      limit: "16",
    });
    return z.array(ShownItem).parse(await this.#request(`Items/Latest?${query.toString()}`));
  }

  /** Continue Watching as the server orders it, most recently played first. */
  async resumeIds(): Promise<string[]> {
    const { Items } = z
      .object({ Items: z.array(z.object({ Id: z.string() })) })
      .parse(
        await this.#request(
          `UserItems/Resume?userId=${this.session.userId}&mediaTypes=Video&limit=16`,
        ),
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
      },
    );
    if (!response.ok) throw new Error(`QuickConnect/Authorize: HTTP ${response.status}`);
  }

  /** Forgets a device and revokes its token (admin only): how a test cleans up an app that signed in itself. */
  async deleteDevice(deviceId: string): Promise<void> {
    await this.#request(`Devices?id=${encodeURIComponent(deviceId)}`, { method: "DELETE" });
  }

  /** Every device id the server holds a token for. */
  async deviceIds(): Promise<string[]> {
    const { Items } = z
      .object({ Items: z.array(z.object({ Id: z.string() })) })
      .parse(await this.#request("Devices"));
    return Items.map((device) => device.Id);
  }

  async signOut(): Promise<void> {
    await this.#request("Sessions/Logout", { method: "POST" });
  }
}
