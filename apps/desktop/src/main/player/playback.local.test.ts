// @vitest-environment node
import { execFile } from "node:child_process";
import { once } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify, inspect } from "node:util";

import { ItemId } from "@harakiri/jellyfin";
import type { BaseItemDto, PlaybackInfoResponse } from "@harakiri/jellyfin/generated";
import { PRD_PASSTHROUGH } from "@harakiri/mpv";
import { configure, defaultTextFormatter, reset as resetLogging } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { Session } from "../../shared/bridge";
import type { PlayerEvent, PlayerProbe } from "../../shared/bridge";
import { preparePlayback, startPlayback } from "./playback";
import type { Playback } from "./playback";

const TOKEN = "fakeToken7c1d9e";
const ITEM = "0123456789abcdef0123456789abcdef";
const SOURCE = "0123456789abcdef0123456789abcdef";
const TICKS = 10_000_000;
const SUBTITLE_PATH = `/Videos/${ITEM}/${SOURCE}/Subtitles/0/0/Stream.subrip`;

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly authorized: boolean;
  readonly body: unknown;
}

const json = (res: ServerResponse, body: PlaybackInfoResponse | BaseItemDto): void => {
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
};

const serveFile = (req: IncomingMessage, res: ServerResponse, bytes: Buffer): void => {
  const range = /^bytes=(?<first>\d+)-(?<last>\d*)$/u.exec(req.headers.range ?? "");

  if (range === null) {
    res.writeHead(200, { "Accept-Ranges": "bytes", "Content-Length": bytes.length }).end(bytes);

    return;
  }

  const start = Number(range.groups?.first);
  const last = range.groups?.last;
  const end = last === undefined || last === "" ? bytes.length - 1 : Number(last);
  res
    .writeHead(206, {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
      "Content-Length": end - start + 1,
    })
    .end(bytes.subarray(start, end + 1));
};

const TcpAddress = z.object({ port: z.number() });

/** Just enough of Jellyfin to play one item, refusing any request without the token header. */
class FakeJellyfin {
  readonly requests: Recorded[] = [];
  media = "";
  runTimeTicks = 0;
  /** How long the stop report waits before the server answers it. */
  stopDelayMs = 0;
  /** When the server finished answering the stop report. */
  stopAnsweredAt: number | undefined;
  /** The sidecar subtitle request is held open and never answered. */
  stallSidecar = false;
  /** The item request (the overlay's title) is held open and never answered. */
  stallItem = false;
  private readonly server: Server = createServer((req, res) => {
    void this.handle(req, res);
  });

  async listen(): Promise<string> {
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    const { port } = TcpAddress.parse(this.server.address());

    return `http://127.0.0.1:${port}`;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    this.server.close();
    await once(this.server, "close");
  }

  posted(route: string): unknown[] {
    return this.requests.filter((r) => r.method === "POST" && r.url === route).map((r) => r.body);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    req.setEncoding("utf-8");
    let text = "";

    for await (const chunk of req) {
      text += String(chunk);
    }

    const url = req.url ?? "";
    const authorized = (req.headers.authorization ?? "").includes(`Token="${TOKEN}"`);
    this.requests.push({
      method: req.method ?? "",
      url,
      authorized,
      body: text ? z.json().parse(JSON.parse(text)) : undefined,
    });

    if (!authorized) {
      res.writeHead(401).end();

      return;
    }

    const [route] = url.split("?");

    if (route === `/Items/${ITEM}/PlaybackInfo`) {
      json(res, this.playbackInfo());

      return;
    }

    if (route === `/Items/${ITEM}` && this.stallItem) {
      return;
    }

    if (route === `/Items/${ITEM}`) {
      json(res, { Name: "Synthetic", Type: "Movie", RunTimeTicks: this.runTimeTicks });

      return;
    }

    if (route === "/Sessions/Playing/Stopped") {
      await setTimeout(this.stopDelayMs);
      this.stopAnsweredAt = Date.now();
      res.writeHead(204).end();

      return;
    }

    if (route?.startsWith("/Sessions/Playing") === true) {
      res.writeHead(204).end();

      return;
    }

    if (route === SUBTITLE_PATH && this.stallSidecar) {
      return;
    }

    if (route === SUBTITLE_PATH) {
      res
        .writeHead(200, { "Content-Type": "application/x-subrip" })
        .end("1\n00:00:00,000 --> 00:00:30,000\nSidecar\n");

      return;
    }

    if (route === `/Videos/${ITEM}/stream`) {
      serveFile(req, res, await readFile(this.media));

      return;
    }

    res.writeHead(404).end();
  }

  private playbackInfo(): PlaybackInfoResponse {
    return {
      PlaySessionId: "play-session-1",
      MediaSources: [
        {
          Id: SOURCE,
          RunTimeTicks: this.runTimeTicks,
          SupportsDirectPlay: true,
          DefaultAudioStreamIndex: 2,
          MediaStreams: [
            {
              Type: "Subtitle",
              Index: 0,
              Codec: "subrip",
              Language: "eng",
              IsExternal: true,
              DeliveryMethod: "External",
              DeliveryUrl: `${SUBTITLE_PATH}?ApiKey=${TOKEN}`,
            },
            { Type: "Video", Index: 1, Codec: "mpeg4", VideoRangeType: "SDR" },
            { Type: "Audio", Index: 2, Codec: "flac", Channels: 2 },
          ],
        },
      ],
    };
  }
}

/** The mpv this test process spawned, found the way any other local user could find it. */
const mpvChild = () => {
  for (const pid of readdirSync("/proc").filter((name) => /^\d+$/u.test(name))) {
    try {
      const ppid = readFileSync(`/proc/${pid}/stat`, "utf-8").split(") ")[1]?.split(" ")[1];

      if (Number(ppid) !== process.pid) {
        continue;
      }

      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8");

      if (cmdline.split("\0")[0]?.endsWith("mpv") === true) {
        return { pid: Number(pid), cmdline };
      }
    } catch {
      // The process exited while we looked.
    }
  }

  throw new Error("no mpv child process");
};

/** Polls the playback every 100 ms until `check` holds, and fails with the last probe after 20 s. */
const until = async (
  what: string,
  playback: Playback,
  check: (probe: PlayerProbe) => boolean
): Promise<PlayerProbe> => {
  const deadline = Date.now() + 20_000;

  const poll = async (): Promise<PlayerProbe> => {
    const last = await playback.probe();

    if (check(last)) {
      return last;
    }

    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${what}; last probe ${JSON.stringify(last)}`);
    }

    await setTimeout(100);

    return await poll();
  };

  return await poll();
};

// oxlint-disable-next-line typescript/strict-void-return -- execFile has no promise form; promisify types it through Node's own __promisify__ overload
const run = promisify(execFile);

const synthesize = async (out: string, seconds: number) =>
  await run("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=duration=${seconds}:size=160x120:rate=10`,
    "-f",
    "lavfi",
    "-i",
    `sine=duration=${seconds}`,
    "-c:v",
    "mpeg4",
    "-c:a",
    "flac",
    "-shortest",
    out,
  ]);

let dir: string;
let shortClip: string;
let longClip: string;
let jellyfin: FakeJellyfin;
let current: Playback | undefined;
const records: LogRecord[] = [];

/** Every log line as the console sink would print it, with its structured values. */
const logged = (): string =>
  records
    .flatMap((record) => [
      defaultTextFormatter(record),
      inspect(record.properties, { depth: Infinity }),
    ])
    .join("\n");

const configureLogging = async () => {
  await configure({
    reset: true,
    sinks: {
      memory: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ["harakiri"], lowestLevel: "debug", sinks: ["memory"] },
      { category: ["logtape", "meta"], sinks: [] },
    ],
  });
};

const session = (serverUrl: string) =>
  Session.parse({
    serverUrl,
    serverId: "fake",
    serverName: "Fake",
    serverVersion: "10.11.0",
    userId: "fedcba9876543210fedcba9876543210",
    userName: "tester",
    accessToken: TOKEN,
    deviceId: "playback-test",
  });

const identity = { client: "Harakiri", device: "vitest", version: "0.0.0-test" };

const play = async (
  media: string,
  seconds: number,
  setup: (server: FakeJellyfin) => void = () => {}
): Promise<{ events: PlayerEvent[]; playback: Playback }> => {
  jellyfin = new FakeJellyfin();
  setup(jellyfin);
  jellyfin.media = media;
  jellyfin.runTimeTicks = seconds * TICKS;
  const serverUrl = await jellyfin.listen();
  const events: PlayerEvent[] = [];

  const playback = await startPlayback(
    { itemId: ItemId.parse(ITEM), subtitleStreamIndex: 0 },
    (event) => {
      events.push(event);
    },
    {
      session: session(serverUrl),
      identity,
      configDir: path.join(dir, "mpv"),
      extraArgs: ["--vo=null", "--ao=null"],
      audioOutput: { kind: "known", name: "test receiver", bitstream: [...PRD_PASSTHROUGH] },
    }
  );

  current = playback;

  return { events, playback };
};

describe("playback against a fake Jellyfin, with real mpv", () => {
  beforeAll(async () => {
    await configureLogging();
    dir = await mkdtemp(path.join(tmpdir(), "harakiri-playback-test-"));
    shortClip = path.join(dir, "short.mkv");
    longClip = path.join(dir, "long.mkv");
    await Promise.all([synthesize(shortClip, 2), synthesize(longClip, 30)]);
  });

  afterEach(async () => {
    await current?.stop();
    current = undefined;
    await jellyfin.close();
  });

  afterAll(async () => {
    await resetLogging();
    await rm(dir, { recursive: true, force: true });
  });

  it("a short clip plays to its natural end, emits `ended`, and reports the stop", async () => {
    const { events, playback } = await play(shortClip, 2);
    await playback.done;

    expect(events.slice(-2)).toMatchObject([
      { phase: "ended", itemId: ITEM },
      { phase: "reported" },
    ]);
    expect(events.map((e) => e.phase)).toStrictEqual(
      expect.arrayContaining(["starting", "playing"])
    );
    expect(jellyfin.posted("/Sessions/Playing")).toHaveLength(1);
    const ended = events.at(-2)?.positionTicks ?? 0;
    // The stop report carries the same position the `ended` event does.
    expect(jellyfin.posted("/Sessions/Playing/Stopped")).toStrictEqual([
      {
        ItemId: ITEM,
        MediaSourceId: SOURCE,
        PlaySessionId: "play-session-1",
        PositionTicks: ended,
        Failed: false,
      },
    ]);
    expect(Math.abs(ended - 2 * TICKS)).toBeLessThan(TICKS / 2);
  });

  it("`stopped` reaches the renderer once mpv quits, and `reported` only once the slow stop report is answered", async () => {
    const { events, playback } = await play(longClip, 30);
    await until("playing past 1 s", playback, (p) => (p.timePos ?? 0) > 1);
    jellyfin.stopDelayMs = 1500;
    const at = new Map<string, number>();
    const watched = events.push.bind(events);
    events.push = (...added: PlayerEvent[]) => {
      for (const event of added) {
        at.set(event.phase, Date.now());
      }

      return watched(...added);
    };

    await playback.stop();
    const stopResolvedAt = Date.now();

    expect(events.slice(-2)).toMatchObject([
      { phase: "stopped" },
      { phase: "reported", itemId: ITEM, positionTicks: events.at(-2)?.positionTicks },
    ]);
    const answered = jellyfin.stopAnsweredAt ?? Number.NaN;
    const stoppedAt = at.get("stopped") ?? Number.NaN;
    const reportedAt = at.get("reported") ?? Number.NaN;
    // The screen comes back before the server has answered...
    expect(answered - stoppedAt).toBeGreaterThan(1000);
    // ...and the refetch signal and stop() wait for the answer.
    expect(reportedAt).toBeGreaterThanOrEqual(answered);
    expect(stopResolvedAt).toBeGreaterThanOrEqual(reportedAt);
    expect(jellyfin.posted("/Sessions/Playing/Stopped")).toStrictEqual([
      expect.objectContaining({ ItemId: ITEM, Failed: false }),
    ]);
  });

  it("the token and the ApiKey sidecar never reach mpv's argv", async () => {
    const { playback } = await play(longClip, 30);
    const playing = await until("the sidecar selected", playback, (p) => p.sid === 1);
    expect(playing.running).toBe(true);

    const { cmdline } = mpvChild();
    expect(cmdline).toContain("--config-dir=");
    expect(cmdline).not.toContain(TOKEN);
    expect(cmdline).not.toContain("ApiKey");
  });

  it("the token reaches mpv over IPC: every stream and sidecar request carries it", async () => {
    const { playback } = await play(longClip, 30);
    await until("the sidecar selected", playback, (p) => p.sid === 1);

    const media = jellyfin.requests.filter((r) => r.url.startsWith(`/Videos/${ITEM}/`));
    expect(media.map((r) => [r.url.split("?")[0], r.authorized])).toStrictEqual(
      expect.arrayContaining([
        [`/Videos/${ITEM}/stream`, true],
        [SUBTITLE_PATH, true],
      ])
    );
    expect(media.every((r) => r.authorized)).toBe(true);
  });

  it("a sidecar mpv never finishes loading leaves its ApiKey out of the log and the events", async () => {
    records.length = 0;

    const { events, playback } = await play(longClip, 30, (server) => {
      server.stallSidecar = true;
    });

    // sub-add waits on the held request until the client's 10 s timeout gives mpv up as dead.
    await playback.done;

    expect(events.map((e) => e.phase).slice(-2)).toStrictEqual(["error", "reported"]);
    expect(logged()).toContain("mpv could not load a sidecar subtitle");
    expect(logged()).toContain('"sub-add"');
    expect(logged()).not.toContain(TOKEN);
    expect(JSON.stringify(events)).not.toContain(TOKEN);
  }, 30_000);

  it("the handoff's decision waits on PlaybackInfo alone; a stalled title fetch falls back to a plain title", async () => {
    jellyfin = new FakeJellyfin();
    jellyfin.stallItem = true;
    const serverUrl = await jellyfin.listen();
    const startedAt = Date.now();

    const prepared = await preparePlayback(
      { itemId: ItemId.parse(ITEM) },
      { session: session(serverUrl), identity }
    );

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(prepared.resolution.method).toBe("DirectPlay");

    await expect(prepared.entry).resolves.toStrictEqual({ title: "Untitled", programme: "" });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(2900);
  });

  it("mpv killed mid-play ends playback with `error` and a failed stop report", async () => {
    const { events, playback } = await play(longClip, 30);
    await until("playing past 1 s", playback, (p) => (p.timePos ?? 0) > 1);

    process.kill(mpvChild().pid, "SIGKILL");
    await playback.done;

    expect(events.at(-1)?.phase).toBe("reported");
    expect(events.at(-2)).toMatchObject({
      phase: "error",
      error: "mpv exited unexpectedly (code SIGKILL)",
    });
    expect(jellyfin.posted("/Sessions/Playing/Stopped")).toStrictEqual([
      expect.objectContaining({ ItemId: ITEM, Failed: true }),
    ]);
    await expect(playback.probe()).resolves.toStrictEqual({ running: false });
  });
});
