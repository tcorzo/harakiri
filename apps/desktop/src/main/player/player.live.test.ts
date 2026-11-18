// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ItemId, joinFacts } from "@harakiri/jellyfin";
import { corpusEntry, loadCorpus, matchCorpus } from "@harakiri/jellyfin/corpus";
import type { CorpusMatch } from "@harakiri/jellyfin/corpus";
import { afterAll, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import { Session } from "../../shared/bridge";
import type { PlayerEvent, PlayerProbe } from "../../shared/bridge";

const harness = vi.hoisted(() => {
  process.env.HARAKIRI_E2E = "1";
  process.env.HARAKIRI_MPV_ARGS = "--vo=null --ao=null";

  return { userData: "", session: null as z.infer<typeof Session> | null };
});

vi.mock("electron", () => ({
  app: { getPath: () => harness.userData, getVersion: () => "0.0.0-test" },
}));

vi.mock("../session", () => ({
  loadSession: () => harness.session,
  deviceId: () => harness.session?.deviceId ?? "none",
}));

const { play, probe, stop } = await import("./index");

const SERVER = process.env.JELLYFIN_DEV_URL ?? "http://127.0.0.1:8096";
const DEVICE_ID = "harakiri-player-test";
const TICKS = 10_000_000;

// The live tier (`mise run test:live`): it writes to the server, so `mise run test` never runs
// it, and it fails, never skips, when the server is down.
const reachable = await fetch(`${SERVER}/System/Info/Public`, { signal: AbortSignal.timeout(2000) })
  .then((response) => response.ok)
  .catch(() => false);

if (!reachable) {
  throw new Error(
    `the Jellyfin at ${SERVER} is unreachable: set JELLYFIN_DEV_URL (and JELLYFIN_DEV_USER, JELLYFIN_DEV_PASSWORD) to your server, or run \`mise run jellyfin:up\` for the dev container`
  );
}

const clientHeader = (token?: string) =>
  `MediaBrowser Client="harakiri-test", Device="vitest", DeviceId="${DEVICE_ID}", Version="0"${token ? `, Token="${token}"` : ""}`;

async function api<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SERVER}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: clientHeader(harness.session?.accessToken),
    },
  });

  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status}`);
  }
  const body = await response.text();

  return schema.parse(body ? JSON.parse(body) : undefined);
}

const SystemInfo = z.object({ Id: z.string(), ServerName: z.string(), Version: z.string() });

const Auth = z.object({
  AccessToken: z.string(),
  User: z.object({ Id: z.string(), Name: z.string() }),
});

const UserData = z.object({ PlaybackPositionTicks: z.number().optional() });

const Stream = z.object({
  Type: z.string(),
  Index: z.number(),
  Codec: z.string().nullish(),
  VideoRangeType: z.string().nullish(),
  IsExternal: z.boolean().optional(),
});

type Stream = z.infer<typeof Stream>;

const Items = z.object({
  Items: z.array(
    z.object({
      Id: z.string(),
      Path: z.string().nullish(),
      RunTimeTicks: z.number().nullish(),
      MediaStreams: z.array(Stream).nullish(),
    })
  ),
});

const MpvReply = z.object({
  request_id: z.number().optional(),
  error: z.string().optional(),
  // Events arriving on the same connection carry no `data`.
  data: z.unknown().optional(),
});

const TrackList = z.array(
  z.object({
    type: z.string(),
    id: z.number(),
    "ff-index": z.number().optional(),
    external: z.boolean(),
    "external-filename": z.string().optional(),
    title: z.string().optional(),
  })
);

async function signIn(): Promise<Session> {
  const info = await api("/System/Info/Public", SystemInfo);

  const auth = await api("/Users/AuthenticateByName", Auth, {
    method: "POST",
    body: JSON.stringify({
      Username: process.env.JELLYFIN_DEV_USER ?? "harakiri",
      Pw: process.env.JELLYFIN_DEV_PASSWORD ?? "harakiri-dev",
    }),
  });

  return Session.parse({
    serverUrl: SERVER,
    serverId: info.Id,
    serverName: info.ServerName,
    serverVersion: info.Version,
    userId: auth.User.Id,
    userName: auth.User.Name,
    accessToken: auth.AccessToken,
    deviceId: DEVICE_ID,
  });
}

const libraryItems = async (session: Session) =>
  (
    await api(
      `/Items?userId=${session.userId}&Recursive=true&IncludeItemTypes=Movie,Episode&Fields=MediaStreams,Path&SortBy=RunTimeTicks&SortOrder=Ascending`,
      Items
    )
  ).Items.map((item) => ({ ...item, path: item.Path ?? "" }));

type Item = Awaited<ReturnType<typeof libraryItems>>[number];

const catalog = await loadCorpus();

/**
 * On the generated corpus, the catalog entry built for the test; on any other server, the first
 * item that meets the same criteria, so the tier also runs against an own library.
 */
const pickItem = (
  items: readonly Item[],
  corpus: CorpusMatch<Item> | undefined,
  id: string,
  fits: (item: Item) => boolean,
  what: string
): Item => {
  const item = corpus ? corpus.item(corpusEntry(catalog, id)) : items.find(fits);

  if (!item) {
    throw new Error(`the library at ${SERVER} has no ${what}`);
  }

  return item;
};

const userData = async (session: Session, itemId: string) =>
  api(`/UserItems/${itemId}/UserData?userId=${session.userId}`, UserData);

const restoreUserData = async (session: Session, itemId: string, ticks: number | undefined) =>
  api(`/UserItems/${itemId}/UserData?userId=${session.userId}`, z.unknown(), {
    method: "POST",
    body: JSON.stringify({ PlaybackPositionTicks: ticks ?? 0 }),
  });

const byIndex = (a: Stream, b: Stream) => a.Index - b.Index;

/** The IPC socket of the mpv this test process spawned, found the way any second client would. */
function mpvSocket(): string {
  for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    try {
      const ppid = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.split(" ")[1];

      if (Number(ppid) !== process.pid) {
        continue;
      }
      const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
      const socket = args.find((arg) => arg.startsWith("--input-ipc-server="));

      if (socket) {
        return socket.slice("--input-ipc-server=".length);
      }
    } catch {
      // The process exited while we looked.
    }
  }

  throw new Error("no mpv child process");
}

/** Sends one command over a second IPC connection and returns mpv's reply data. */
async function mpvCommand(...command: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(mpvSocket());
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("error", reject);
    socket.on("data", (chunk: string) => {
      buffer += chunk;

      for (const line of buffer.split("\n").slice(0, -1)) {
        const message = MpvReply.parse(JSON.parse(line));

        if (message.request_id !== 7) {
          continue;
        }
        socket.end();

        if (message.error === "success") {
          resolve(message.data);
        } else {
          reject(new Error(`${JSON.stringify(command)}: ${message.error}`));
        }
      }

      buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
    });
    socket.write(`${JSON.stringify({ command, request_id: 7 })}\n`);
  });
}

async function until(
  what: string,
  check: (probe: PlayerProbe) => boolean,
  timeoutMs = 30_000
): Promise<PlayerProbe> {
  const deadline = Date.now() + timeoutMs;
  let last: PlayerProbe = { running: false };

  while (Date.now() < deadline) {
    last = await probe();

    if (check(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`timed out waiting for ${what}; last probe ${JSON.stringify(last)}`);
}

const userDataDirs: string[] = [];

const freshUserData = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "harakiri-player-test-"));
  userDataDirs.push(dir);

  return dir;
};

afterAll(async () => {
  await stop();

  for (const dir of userDataDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe(`player against the dev Jellyfin at ${SERVER}`, () => {
  test(
    "plays from 60 s, pauses on select, and the stop position becomes the server's resume point",
    { timeout: 90_000 },
    async () => {
      harness.userData = freshUserData();
      harness.session = await signIn();
      const items = await libraryItems(harness.session);

      const item = pickItem(
        items,
        matchCorpus(catalog, items),
        "sdr-h264-aac-long",
        (candidate) =>
          // Jellyfin keeps no resume point under 5 min runtime or under 5% watched, so 61 s
          // needs a runtime between 5 and 20 minutes.
          (candidate.RunTimeTicks ?? 0) > 360 * TICKS &&
          (candidate.RunTimeTicks ?? 0) < 1200 * TICKS &&
          (candidate.MediaStreams ?? []).some(
            (s) => s.Type === "Video" && s.Codec === "h264" && s.VideoRangeType === "SDR"
          ),
        "SDR H.264 item between 6 and 20 minutes"
      );

      const before = await userData(harness.session, item.Id);

      const events: PlayerEvent[] = [];

      try {
        await play({ itemId: ItemId.parse(item.Id), startPositionTicks: 60 * TICKS }, (event) =>
          events.push(event)
        );

        const advancing = await until("time-pos past 61 s", (p) => (p.timePos ?? 0) > 61);
        expect(advancing).toMatchObject({ running: true, pause: false });
        expect(advancing.path).toContain(`/Videos/${item.Id}/stream?static=true`);

        await mpvCommand("script-message", "harakiri", "select");
        const paused = await until("pause after select", (p) => p.pause === true);
        expect(paused.osdVisible).toBe(true);

        await mpvCommand("keypress", "ENTER");
        await until("ENTER through input.conf resumes", (p) => p.pause === false);
        await mpvCommand("keypress", "GAMEPAD_ACTION_DOWN");

        const repaused = await until(
          "gamepad A through input.conf pauses",
          (p) => p.pause === true
        );

        await stop();
        expect(await probe()).toEqual({ running: false });

        // stop() resolves after the stop report, so `reported` has already followed `stopped`.
        expect(events.slice(-2).map((e) => e.phase)).toEqual(["stopped", "reported"]);
        const stopped = events.at(-2);
        const stoppedTicks = stopped?.positionTicks ?? 0;
        expect(Math.abs(stoppedTicks - (repaused.timePos ?? 0) * TICKS)).toBeLessThan(TICKS);
        expect(events.map((e) => e.phase)).toEqual(
          expect.arrayContaining(["starting", "playing", "paused", "stopped"])
        );
        expect(joinFacts(events[0]?.facts ?? [])).toMatch(/^SDR · /);
        expect(events[0]?.transcodeReasons).toEqual([]);

        const after = await userData(harness.session, item.Id);
        expect(stoppedTicks).toBeGreaterThan(61 * TICKS);
        expect(Math.abs((after.PlaybackPositionTicks ?? 0) - stoppedTicks)).toBeLessThan(2 * TICKS);
      } finally {
        await stop();
        await restoreUserData(harness.session, item.Id, before.PlaybackPositionTicks);
      }
    }
  );

  test(
    "the chosen Jellyfin audio and sidecar subtitle land on the matching mpv tracks",
    { timeout: 90_000 },
    async () => {
      harness.userData = freshUserData();
      harness.session ??= await signIn();
      const items = await libraryItems(harness.session);
      const corpus = matchCorpus(catalog, items);

      const item = pickItem(
        items,
        corpus,
        "sdr-h264-tracks",
        (candidate) => {
          const streams = candidate.MediaStreams ?? [];

          return (
            streams.filter((s) => s.Type === "Audio").length >= 2 &&
            streams.some((s) => s.Type === "Subtitle" && s.IsExternal) &&
            streams.some((s) => s.Type === "Subtitle" && !s.IsExternal)
          );
        },
        "item with two audio tracks and embedded and sidecar subtitles"
      );

      const streams = item.MediaStreams ?? [];
      const sidecars = streams.filter((s) => s.Type === "Subtitle" && s.IsExternal);
      const embeddedSubs = streams.filter((s) => s.Type === "Subtitle" && !s.IsExternal);
      const secondAudio = streams.filter((s) => s.Type === "Audio").toSorted(byIndex)[1];
      const sidecar = sidecars.toSorted(byIndex)[0];

      if (!secondAudio || !sidecar) {
        throw new Error("unreachable: checked by the find above");
      }

      const counts = {
        audio: streams.filter((s) => s.Type === "Audio").length,
        embedded: embeddedSubs.length,
        external: sidecars.length,
      };

      const declared = corpusEntry(catalog, "sdr-h264-tracks").expect;
      expect(counts).toEqual(
        corpus ? { audio: declared.audio.length, ...declared.subtitles } : counts
      );
      const before = await userData(harness.session, item.Id);

      try {
        await play(
          {
            itemId: ItemId.parse(item.Id),
            audioStreamIndex: secondAudio.Index,
            subtitleStreamIndex: sidecar.Index,
          },
          () => {}
        );

        const playing = await until(
          "tracks selected",
          (p) => typeof p.aid === "number" && typeof p.sid === "number"
        );

        expect([playing.aid, playing.sid]).toEqual([2, embeddedSubs.length + 1]);

        const trackList = TrackList.parse(await mpvCommand("get_property", "track-list"));
        const audio = trackList.find((t) => t.type === "audio" && t.id === 2);
        expect(audio?.["ff-index"]).toBe(secondAudio.Index - sidecars.length);
        const subtitle = trackList.find((t) => t.type === "sub" && t.id === playing.sid);
        expect(subtitle?.external).toBe(true);
        expect(subtitle?.["external-filename"]).toContain(`/Subtitles/${sidecar.Index}/0/`);
        expect(trackList.filter((t) => t.external).map((t) => t.title)).toEqual(
          sidecars.map((_, i) => `External ${i + 1}`)
        );
      } finally {
        await stop();
        await restoreUserData(harness.session, item.Id, before.PlaybackPositionTicks);
      }
    }
  );
});
