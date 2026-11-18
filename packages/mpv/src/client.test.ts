import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { inspect, promisify } from "node:util";

import {
  configure,
  defaultTextFormatter,
  getLogger,
  reset as resetLogging,
} from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

import { buildPlaybackArgs } from "./args";
import type { MpvConfig } from "./args";
import {
  MpvClosedError,
  MpvCommandError,
  MpvTimeoutError,
  redactSecrets,
  spawnMpv,
} from "./client";
import type { JsonValue, MpvClient } from "./client";
import { setHttpHeaders } from "./http";
import { createLineSplitter } from "./protocol";

const headless = ["--vo=null", "--ao=null"];

let clipDir: string;
let clip: string;
const clients: MpvClient[] = [];

async function start(
  args: readonly string[] = headless,
  options: { config?: MpvConfig; requestTimeoutMs?: number } = {}
): Promise<MpvClient> {
  const client = await spawnMpv({ config: "none", ...options, args });
  clients.push(client);

  return client;
}

const cmdline = (pid: number) => readFileSync(`/proc/${pid}/cmdline`, "utf-8").split("\0");

beforeAll(async () => {
  clipDir = await mkdtemp(join(tmpdir(), "harakiri-mpv-test-"));
  clip = join(clipDir, "clip.mkv");
  await promisify(execFile)("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=duration=2:size=320x240:rate=25",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=2",
    "-c:v",
    "ffv1",
    "-c:a",
    "flac",
    "-shortest",
    clip,
  ]);
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => client.quit()));
});

afterAll(async () => {
  await rm(clipDir, { recursive: true, force: true });
});

describe("spawnMpv", () => {
  test("talks to the real mpv 0.41", async () => {
    const client = await start();
    expect(await client.getProperty("mpv-version", z.string())).toMatch(/^mpv v0\.41\./);
  });

  test("reports the duration of a loaded clip", async () => {
    const client = await start();

    const loaded = new Promise<void>((resolve) => {
      client.onEvent((event) => {
        if (event.event === "file-loaded") {
          resolve();
        }
      });
    });

    await client.command("loadfile", clip);
    await loaded;
    expect(await client.getProperty("duration", z.number())).toBeCloseTo(2, 1);
  });

  test("observes property changes until unsubscribed", async () => {
    const client = await start();
    const seen: (boolean | undefined)[] = [];

    const unsubscribe = await client.observeProperty("pause", z.boolean(), (value) => {
      seen.push(value);
    });

    await client.setProperty("pause", true);
    await client.command("cycle", "pause");
    await expect.poll(() => seen).toEqual([false, true, false]);

    unsubscribe();
    await client.setProperty("pause", true);
    expect(await client.getProperty("pause", z.boolean())).toBe(true);
    expect(seen).toEqual([false, true, false]);
  });

  test("delivers script-message as a client-message with literal args", async () => {
    const client = await start();

    const received = new Promise<readonly string[]>((resolve) => {
      client.onClientMessage(resolve);
    });

    await client.command("script-message", "harakiri", "up");
    expect(await received).toEqual(["harakiri", "up"]);
  });

  test("rejects a failed command with mpv's error string", async () => {
    const client = await start();
    const failed = client.getProperty("no-such-property", z.unknown());
    await expect(failed).rejects.toBeInstanceOf(MpvCommandError);
    await expect(failed).rejects.toMatchObject({
      mpvError: "property not found",
      command: "get_property",
    });
  });

  test("rejects in-flight requests when mpv dies", async () => {
    const client = await start();
    process.kill(client.pid, "SIGSTOP");
    const inFlight = client.getProperty("mpv-version", z.string());
    process.kill(client.pid, "SIGKILL");
    await expect(inFlight).rejects.toBeInstanceOf(MpvClosedError);
    expect(await client.exited).toEqual({ code: null, signal: "SIGKILL" });
  });

  test("quit exits cleanly and later commands reject", async () => {
    const client = await start();
    expect(await client.quit()).toEqual({ code: 0, signal: null });
    await expect(client.command("get_property", "pause")).rejects.toBeInstanceOf(MpvClosedError);
  });

  test("a request mpv never answers times out, and the client kills that mpv", async () => {
    const client = await start(headless, { requestTimeoutMs: 200 });
    process.kill(client.pid, "SIGSTOP");
    const stalled = client.getProperty("mpv-version", z.string());
    await expect(stalled).rejects.toBeInstanceOf(MpvTimeoutError);
    await expect(stalled).rejects.toMatchObject({
      command: "get_property",
      timeoutMs: 200,
    });
    expect(await client.exited).toEqual({ code: null, signal: "SIGKILL" });
  });

  test("a request that fails before reaching the socket leaves no timer to kill mpv", async () => {
    const client = await start(headless, { requestTimeoutMs: 200 });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- deliberately unencodable
    const unencodable = 1n as unknown as JsonValue;
    await expect(client.command("set_property", "volume", unencodable)).rejects.toBeInstanceOf(
      TypeError
    );
    await delay(400);
    expect(await client.getProperty("pause", z.boolean())).toBe(false);
  });

  test("quit resolves only after the socket dir is gone", async () => {
    const client = await start();

    const socket = cmdline(client.pid)
      .find((arg) => arg.startsWith("--input-ipc-server="))
      ?.slice("--input-ipc-server=".length);

    if (socket === undefined) {
      throw new Error("mpv was spawned without an IPC socket");
    }
    expect(existsSync(dirname(socket))).toBe(true);
    await client.quit();
    expect(existsSync(dirname(socket))).toBe(false);
  });

  test("the config dir comes first in argv and its mpv.conf applies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "harakiri-mpv-config-"));

    try {
      await writeFile(join(dir, "mpv.conf"), "volume=37\n");
      const client = await start(headless, { config: { dir } });
      expect(cmdline(client.pid)[1]).toBe(`--config-dir=${dir}`);
      expect(await client.getProperty("volume", z.number())).toBe(37);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("real mpv accepts the playback args and gets comma-bearing headers over IPC only", async () => {
    const auth = 'MediaBrowser Token="s3cret-token", Client="harakiri"';
    const client = await start([...buildPlaybackArgs(), ...headless]);
    await setHttpHeaders(client, { Authorization: auth, "X-Trace": "1" });
    expect(await client.getProperty("http-header-fields", z.array(z.string()))).toEqual([
      `Authorization: ${auth}`,
      "X-Trace: 1",
    ]);
    expect(cmdline(client.pid).join(" ")).not.toContain("s3cret-token");
    expect(await client.getProperty("audio-spdif", z.string())).toBe("ac3,eac3,dts-hd,truehd");
    expect(await client.getProperty("target-colorspace-hint", z.string())).toBe("auto");
  });

  test("setHttpHeaders refuses a header that would smuggle a second one", async () => {
    const client = await start();
    await expect(setHttpHeaders(client, { Authorization: "x\r\nCookie: y" })).rejects.toThrow(
      new TypeError('invalid HTTP header "Authorization"')
    );
    expect(await client.getProperty("http-header-fields", z.array(z.string()))).toEqual([]);
  });
});

describe("a failed command never carries its arguments", () => {
  const TOKEN = "s3cretTok3n9f";
  const records: LogRecord[] = [];

  beforeAll(async () => {
    await configure({
      reset: true,
      sinks: { memory: (record) => records.push(record) },
      loggers: [
        { category: ["harakiri"], lowestLevel: "debug", sinks: ["memory"] },
        { category: ["logtape", "meta"], sinks: [] },
      ],
    });
  });

  afterAll(async () => {
    await resetLogging();
  });

  /** Everything a caller could print: the message, the error as a value, and its own fields. */
  function printed(error: unknown): string {
    getLogger(["harakiri", "test"]).error("mpv failed: {error}", { error });

    return [
      String(error),
      inspect(error, { depth: Infinity }),
      JSON.stringify(error),
      ...records.map((record) => defaultTextFormatter(record)),
      ...records.map((record) => inspect(record.properties, { depth: Infinity })),
    ].join("\n");
  }

  test("a loadfile of a transcode URL that mpv rejects names the command, not the URL", async () => {
    records.length = 0;
    const client = await start();
    const url = `http://127.0.0.1:1/videos/x/master.m3u8?api_key=${TOKEN}&PlaySessionId=p`;

    const error: unknown = await client
      .command("loadfile", url, "no-such-flag")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MpvCommandError);
    expect(printed(error)).not.toContain(TOKEN);
    expect(error).toMatchObject({ command: "loadfile", mpvError: "invalid parameter" });
    expect(String(error)).toBe('MpvCommandError: mpv command "loadfile" failed: invalid parameter');
  });

  test("verbose mpv output reaches the log with every token redacted, and starts no yt-dlp", async () => {
    records.length = 0;
    const client = await start([...buildPlaybackArgs(), ...headless, "--msg-level=all=v"]);
    await setHttpHeaders(client, { Authorization: `MediaBrowser Token="${TOKEN}", Client="x"` });

    const failed = new Promise<void>((resolve) => {
      client.onEvent((event) => {
        if (event.event === "end-file") {
          resolve();
        }
      });
    });

    await client.command("loadfile", `http://127.0.0.1:1/v.mkv?api_key=${TOKEN}&static=true`);
    await failed;
    await client
      .command("sub-add", `http://127.0.0.1:1/s.srt?ApiKey=${TOKEN}`)
      .catch(() => undefined);
    expect(await client.getProperty("ytdl", z.boolean())).toBe(false);
    await client.quit();

    const lines = records.map((record) => defaultTextFormatter(record));
    expect(lines.some((line) => line.includes("Set property: http-header-fields"))).toBe(true);
    expect(lines.some((line) => line.includes("api_key=REDACTED"))).toBe(true);
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(lines.join("\n")).not.toContain("yt-dlp");
  });

  test("a sub-add of a sidecar URL that mpv never answers names the command, not the URL", async () => {
    records.length = 0;
    const client = await start(headless, { requestTimeoutMs: 200 });
    process.kill(client.pid, "SIGSTOP");
    const url = `http://127.0.0.1:1/Videos/x/Subtitles/0/0/Stream.subrip?ApiKey=${TOKEN}`;

    const error: unknown = await client
      .command("sub-add", url, "auto", "External 1")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MpvTimeoutError);
    expect(printed(error)).not.toContain(TOKEN);
    expect(error).toMatchObject({ command: "sub-add", timeoutMs: 200 });
  });
});

describe("createLineSplitter", () => {
  test("reassembles messages split across chunks", () => {
    const lines: string[] = [];
    const push = createLineSplitter((line) => lines.push(line));
    push('{"event":"pa');
    push('use"}\n{"request_id":1,');
    push('"error":"success"}\n\n{"event"');
    expect(lines).toEqual(['{"event":"pause"}', '{"request_id":1,"error":"success"}']);
  });
});

describe("redactSecrets", () => {
  test("hides Jellyfin tokens in the URLs mpv prints", () => {
    expect(
      redactSecrets(
        " ○ Subs --sid=4 'http://jf/Videos/1/Subtitles/0/0/Stream.subrip?ApiKey=9d4e00ff' (subrip)"
      )
    ).toBe(
      " ○ Subs --sid=4 'http://jf/Videos/1/Subtitles/0/0/Stream.subrip?ApiKey=REDACTED' (subrip)"
    );
    expect(redactSecrets("GET /stream?static=true&api_key=abc&MediaSourceId=x")).toBe(
      "GET /stream?static=true&api_key=REDACTED&MediaSourceId=x"
    );
  });

  test("hides the token in the Authorization header verbose mpv echoes", () => {
    expect(
      redactSecrets(
        '[cplayer] Set property: http-header-fields=["Authorization: MediaBrowser Token=\\"9d4e00ff\\", Client=\\"harakiri\\""] -> 1'
      )
    ).toBe(
      '[cplayer] Set property: http-header-fields=["Authorization: MediaBrowser Token=\\"REDACTED\\", Client=\\"harakiri\\""] -> 1'
    );
    expect(redactSecrets('Authorization: MediaBrowser Client="x", Token="9d4e00ff"')).toBe(
      'Authorization: MediaBrowser Client="x", Token="REDACTED"'
    );
  });
});
