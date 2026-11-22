// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

import { ItemId, joinFacts } from "@harakiri/jellyfin";
import { corpusEntry, loadCorpus, matchCorpus } from "@harakiri/jellyfin/corpus";
import type { CorpusMatch } from "@harakiri/jellyfin/corpus";
import { bundledMpv } from "@harakiri/mpv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { Session } from "../../shared/bridge";
import type { PlayerEvent, PlayerProbe } from "../../shared/bridge";
import { readAudioOutput } from "./audio-output";
import { createPlayer } from "./create-player";
import { preparePlayback, startPlayback } from "./playback";

/** What the player reads from the app, which each test sets: the user data dir and the session. */
interface Harness {
  userData: string;
  session: Session | null;
}

const harness: Harness = { userData: "", session: null };

const { play, probe, stop } = createPlayer({
  loadSession: async () => await Promise.resolve(harness.session),
  userData: () => harness.userData,
  extraArgs: () => ["--vo=null", "--ao=null"],
  audioOutput: readAudioOutput,
  hdrSignalling: async () => await Promise.resolve("colour-management" as const),
  mpvBinary: bundledMpv,
  preparePlayback,
  startPlayback,
});

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
  `MediaBrowser Client="harakiri-test", Device="vitest", DeviceId="${DEVICE_ID}", Version="0"${token === undefined || token === "" ? "" : `, Token="${token}"`}`;

const api = async <T>(route: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${SERVER}${route}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: clientHeader(harness.session?.accessToken),
    },
  });

  if (!response.ok) {
    throw new Error(`${route}: HTTP ${response.status}`);
  }

  const body = await response.text();

  return schema.parse(body ? JSON.parse(body) : undefined);
};

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

const signIn = async (): Promise<Session> => {
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
};

const libraryItems = async (session: Session) => {
  const listed = await api(
    `/Items?userId=${session.userId}&Recursive=true&IncludeItemTypes=Movie,Episode&Fields=MediaStreams,Path&SortBy=RunTimeTicks&SortOrder=Ascending`,
    Items
  );

  return listed.Items.map((item) => ({ ...item, path: item.Path ?? "" }));
};

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
  await api(`/UserItems/${itemId}/UserData?userId=${session.userId}`, UserData);

const restoreUserData = async (session: Session, itemId: string, ticks: number | undefined) =>
  await api(`/UserItems/${itemId}/UserData?userId=${session.userId}`, z.unknown(), {
    method: "POST",
    body: JSON.stringify({ PlaybackPositionTicks: ticks ?? 0 }),
  });

const byIndex = (a: Stream, b: Stream) => a.Index - b.Index;

/** The IPC socket of the mpv this test process spawned, found the way any second client would. */
const mpvSocket = (): string => {
  for (const pid of readdirSync("/proc").filter((name) => /^\d+$/u.test(name))) {
    try {
      const ppid = readFileSync(`/proc/${pid}/stat`, "utf-8").split(") ")[1]?.split(" ")[1];

      if (Number(ppid) !== process.pid) {
        continue;
      }

      const args = readFileSync(`/proc/${pid}/cmdline`, "utf-8").split("\0");
      const socket = args.find((arg) => arg.startsWith("--input-ipc-server="));

      if (socket !== undefined) {
        return socket.slice("--input-ipc-server=".length);
      }
    } catch {
      // The process exited while we looked.
    }
  }

  throw new Error("no mpv child process");
};

/** Sends one command over a second IPC connection and returns mpv's reply data, parsed. */
const mpvCommand = async <T>(schema: z.ZodType<T>, ...command: (string | number)[]): Promise<T> =>
  // oxlint-disable-next-line promise/avoid-new -- wraps the socket's data and error events, which have no promise form
  await new Promise((resolve, reject) => {
    const socket = createConnection(mpvSocket());
    let buffer = "";
    socket.setEncoding("utf-8");
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
          resolve(schema.parse(message.data));
        } else {
          reject(new Error(`${JSON.stringify(command)}: ${message.error}`));
        }
      }

      buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
    });
    socket.write(`${JSON.stringify({ command, request_id: 7 })}\n`);
  });

/** Polls the player every 200 ms until `check` holds, and fails with the last probe after the timeout. */
const until = async (
  what: string,
  check: (probe: PlayerProbe) => boolean,
  timeoutMs = 30_000
): Promise<PlayerProbe> => {
  const deadline = Date.now() + timeoutMs;

  const poll = async (): Promise<PlayerProbe> => {
    const last = await probe();

    if (check(last)) {
      return last;
    }

    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${what}; last probe ${JSON.stringify(last)}`);
    }

    await setTimeout(200);

    return await poll();
  };

  return await poll();
};

const userDataDirs: string[] = [];

const freshUserData = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "harakiri-player-test-"));
  userDataDirs.push(dir);

  return dir;
};

describe(`player against the dev Jellyfin at ${SERVER}`, () => {
  afterAll(async () => {
    await stop();

    for (const dir of userDataDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("plays from 60 s, pauses on select, and the stop position becomes the server's resume point", () => {
    /** What one play of the item showed, observed in `beforeAll` and checked by each test. */
    interface Observed {
      readonly item: Item;
      readonly advancing: PlayerProbe;
      readonly paused: PlayerProbe;
      readonly repaused: PlayerProbe;
      readonly probeAfterStop: PlayerProbe;
      readonly events: readonly PlayerEvent[];
      readonly after: z.infer<typeof UserData>;
    }

    let observed: Observed | undefined;

    const seen = (): Observed => {
      if (observed === undefined) {
        throw new Error("the play in beforeAll did not finish");
      }

      return observed;
    };

    const stoppedTicks = () => seen().events.at(-2)?.positionTicks ?? 0;

    beforeAll(async () => {
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
        await play({ itemId: ItemId.parse(item.Id), startPositionTicks: 60 * TICKS }, (event) => {
          events.push(event);
        });

        const advancing = await until("time-pos past 61 s", (p) => (p.timePos ?? 0) > 61);

        await mpvCommand(z.unknown(), "script-message", "harakiri", "select");
        const paused = await until("pause after select", (p) => p.pause === true);

        await mpvCommand(z.unknown(), "keypress", "ENTER");
        await until("ENTER through input.conf resumes", (p) => p.pause === false);
        await mpvCommand(z.unknown(), "keypress", "GAMEPAD_ACTION_DOWN");

        const repaused = await until(
          "gamepad A through input.conf pauses",
          (p) => p.pause === true
        );

        await stop();
        const probeAfterStop = await probe();

        const after = await userData(harness.session, item.Id);

        observed = { item, advancing, paused, repaused, probeAfterStop, events, after };
      } finally {
        await stop();
        await restoreUserData(harness.session, item.Id, before.PlaybackPositionTicks);
      }
    }, 90_000);

    it("starts the item from 60 s, straight from the server", () => {
      const { advancing, item } = seen();

      expect(advancing).toMatchObject({ running: true, pause: false });
      expect(advancing.path).toContain(`/Videos/${item.Id}/stream?static=true`);
    });

    it("select pauses and shows the controls", () => {
      expect(seen().paused.osdVisible).toBe(true);
    });

    it("stop ends mpv and reports stopped, then reported, at the paused position", () => {
      const { probeAfterStop, events, repaused } = seen();

      expect(probeAfterStop).toStrictEqual({ running: false });
      // stop() resolves after the stop report, so `reported` has already followed `stopped`.
      expect(events.slice(-2).map((e) => e.phase)).toStrictEqual(["stopped", "reported"]);
      expect(Math.abs(stoppedTicks() - (repaused.timePos ?? 0) * TICKS)).toBeLessThan(TICKS);
      expect(events.map((e) => e.phase)).toStrictEqual(
        expect.arrayContaining(["starting", "playing", "paused", "stopped"])
      );
    });

    it("the first event states a direct SDR play", () => {
      const { events } = seen();

      expect(joinFacts(events[0]?.facts ?? [])).toMatch(/^SDR · /u);
      expect(events[0]?.transcodeReasons).toStrictEqual([]);
    });

    it("the stop position becomes the server's resume point", () => {
      const { after } = seen();

      expect(stoppedTicks()).toBeGreaterThan(61 * TICKS);
      expect(Math.abs((after.PlaybackPositionTicks ?? 0) - stoppedTicks())).toBeLessThan(2 * TICKS);
    });
  });

  it(
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
            streams.some((s) => s.Type === "Subtitle" && s.IsExternal === true) &&
            streams.some((s) => s.Type === "Subtitle" && s.IsExternal !== true)
          );
        },
        "item with two audio tracks and embedded and sidecar subtitles"
      );

      const streams = item.MediaStreams ?? [];
      const sidecars = streams.filter((s) => s.Type === "Subtitle" && s.IsExternal === true);
      const embeddedSubs = streams.filter((s) => s.Type === "Subtitle" && s.IsExternal !== true);
      const [, secondAudio] = streams.filter((s) => s.Type === "Audio").toSorted(byIndex);
      const [sidecar] = sidecars.toSorted(byIndex);

      if (!secondAudio || !sidecar) {
        throw new Error("unreachable: checked by the find above");
      }

      const counts = {
        audio: streams.filter((s) => s.Type === "Audio").length,
        embedded: embeddedSubs.length,
        external: sidecars.length,
      };

      const declared = corpusEntry(catalog, "sdr-h264-tracks").expect;
      expect(counts).toStrictEqual(
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
          (p) => p.aid !== undefined && p.aid !== false && p.sid !== undefined && p.sid !== false
        );

        expect([playing.aid, playing.sid]).toStrictEqual([2, embeddedSubs.length + 1]);

        const trackList = await mpvCommand(TrackList, "get_property", "track-list");
        const audio = trackList.find((t) => t.type === "audio" && t.id === 2);
        expect(audio?.["ff-index"]).toBe(secondAudio.Index - sidecars.length);
        const subtitle = trackList.find((t) => t.type === "sub" && t.id === playing.sid);
        expect(subtitle?.external).toBe(true);
        expect(subtitle?.["external-filename"]).toContain(`/Subtitles/${sidecar.Index}/0/`);
        expect(trackList.filter((t) => t.external).map((t) => t.title)).toStrictEqual(
          sidecars.map((_, i) => `External ${i + 1}`)
        );
      } finally {
        await stop();
        await restoreUserData(harness.session, item.Id, before.PlaybackPositionTicks);
      }
    }
  );
});
