import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { inspect } from "node:util";

import {
  configure,
  defaultTextFormatter,
  getLogger,
  reset as resetLogging,
} from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { buildPlaybackArgs } from "./args";
import type { MpvConfig } from "./args";
import {
  MpvClosedError,
  MpvCommandError,
  MpvStartError,
  MpvTimeoutError,
  redactSecrets,
  spawnMpv,
} from "./client";
import type { JsonValue, MpvClient, MpvEvent } from "./client";
import { setHttpHeaders } from "./http";
import { createLineSplitter } from "./protocol";

const headless = ["--vo=null", "--ao=null"];

let clipDir: string;
let clip: string;
const clients: MpvClient[] = [];

const start = async (
  args: readonly string[] = headless,
  options: { config?: MpvConfig; requestTimeoutMs?: number } = {}
): Promise<MpvClient> => {
  const client = await spawnMpv({ config: "none", ...options, args });
  clients.push(client);

  return client;
};

const rejectionOf = async (pending: Promise<unknown>): Promise<Error> => {
  try {
    await pending;
  } catch (error) {
    return z.instanceof(Error).parse(error);
  }

  throw new Error("expected the promise to reject");
};

const cmdline = (pid: number) => readFileSync(`/proc/${pid}/cmdline`, "utf-8").split("\0");

/** SIGSTOP lands asynchronously; until the kernel reports state T, mpv can still answer. */
const freeze = async (pid: number): Promise<void> => {
  process.kill(pid, "SIGSTOP");
  await vi.waitFor(() => {
    expect(readFileSync(`/proc/${pid}/stat`, "utf-8").split(") ")[1]?.[0]).toBe("T");
  });
};

describe("mpv IPC client", () => {
  beforeAll(async () => {
    clipDir = await mkdtemp(path.join(tmpdir(), "harakiri-mpv-test-"));
    clip = path.join(clipDir, "clip.mkv");
    execFileSync("ffmpeg", [
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
    await Promise.all(clients.splice(0).map(async (client) => await client.quit()));
  });

  afterAll(async () => {
    await rm(clipDir, { recursive: true, force: true });
  });

  describe(spawnMpv, () => {
    it("talks to the real mpv 0.41", async () => {
      const client = await start();
      await expect(client.getProperty("mpv-version", z.string())).resolves.toMatch(
        /^mpv v0\.41\./u
      );
    });

    it("reports the duration of a loaded clip", async () => {
      const client = await start();

      const { promise: loaded, resolve } = Promise.withResolvers<MpvEvent>();
      client.onEvent((event) => {
        if (event.event === "file-loaded") {
          resolve(event);
        }
      });

      await client.command("loadfile", clip);
      await loaded;
      await expect(client.getProperty("duration", z.number())).resolves.toBeCloseTo(2, 1);
    });

    it("observes property changes until unsubscribed", async () => {
      const client = await start();
      const seen: (boolean | undefined)[] = [];

      const unsubscribe = await client.observeProperty("pause", z.boolean(), (value) => {
        seen.push(value);
      });

      await client.setProperty("pause", true);
      await client.command("cycle", "pause");
      await expect.poll(() => seen).toStrictEqual([false, true, false]);

      unsubscribe();
      await client.setProperty("pause", true);
      await expect(client.getProperty("pause", z.boolean())).resolves.toBe(true);
      expect(seen).toStrictEqual([false, true, false]);
    });

    it("delivers script-message as a client-message with literal args", async () => {
      const client = await start();

      const { promise: received, resolve } = Promise.withResolvers<readonly string[]>();
      client.onClientMessage(resolve);

      await client.command("script-message", "harakiri", "up");
      await expect(received).resolves.toStrictEqual(["harakiri", "up"]);
    });

    it("rejects a failed command with mpv's error string", async () => {
      const client = await start();
      const failed = client.getProperty("no-such-property", z.unknown());
      await expect(failed).rejects.toBeInstanceOf(MpvCommandError);
      await expect(failed).rejects.toMatchObject({
        mpvError: "property not found",
        command: "get_property",
      });
    });

    it("rejects in-flight requests when mpv dies", async () => {
      const client = await start();
      await freeze(client.pid);
      const inFlight = client.getProperty("mpv-version", z.string());
      process.kill(client.pid, "SIGKILL");
      await expect(inFlight).rejects.toBeInstanceOf(MpvClosedError);
      await expect(client.exited).resolves.toStrictEqual({ code: null, signal: "SIGKILL" });
    });

    it("quit exits cleanly and later commands reject", async () => {
      const client = await start();
      await expect(client.quit()).resolves.toStrictEqual({ code: 0, signal: null });
      await expect(client.command("get_property", "pause")).rejects.toBeInstanceOf(MpvClosedError);
    });

    it("a request mpv never answers times out, and the client kills that mpv", async () => {
      const client = await start(headless, { requestTimeoutMs: 200 });
      await freeze(client.pid);
      const stalled = client.getProperty("mpv-version", z.string());
      await expect(stalled).rejects.toBeInstanceOf(MpvTimeoutError);
      await expect(stalled).rejects.toMatchObject({
        command: "get_property",
        timeoutMs: 200,
      });
      await expect(client.exited).resolves.toStrictEqual({ code: null, signal: "SIGKILL" });
    });

    it("a request that fails before reaching the socket leaves no timer to kill mpv", async () => {
      const client = await start(headless, { requestTimeoutMs: 200 });
      // A circular value cannot be JSON-encoded, so the request fails before it reaches the socket.
      const unencodable: { [key: string]: JsonValue } = {};
      unencodable.self = unencodable;
      await expect(client.command("set_property", "volume", unencodable)).rejects.toBeInstanceOf(
        TypeError
      );
      await delay(400);
      await expect(client.getProperty("pause", z.boolean())).resolves.toBe(false);
    });

    it("quit resolves only after the socket dir is gone", async () => {
      const client = await start();

      const socket = cmdline(client.pid)
        .find((arg) => arg.startsWith("--input-ipc-server="))
        ?.slice("--input-ipc-server=".length);

      if (socket === undefined) {
        throw new Error("mpv was spawned without an IPC socket");
      }

      expect(existsSync(path.dirname(socket))).toBe(true);
      await client.quit();
      expect(existsSync(path.dirname(socket))).toBe(false);
    });

    it("the config dir comes first in argv and its mpv.conf applies", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "harakiri-mpv-config-"));

      try {
        await writeFile(path.join(dir, "mpv.conf"), "volume=37\n");
        const client = await start(headless, { config: { dir } });
        expect(cmdline(client.pid)[1]).toBe(`--config-dir=${dir}`);
        await expect(client.getProperty("volume", z.number())).resolves.toBe(37);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("real mpv accepts the playback args and gets comma-bearing headers over IPC only", async () => {
      const auth = 'MediaBrowser Token="s3cret-token", Client="harakiri"';
      const client = await start([...buildPlaybackArgs(), ...headless]);
      await setHttpHeaders(client, { Authorization: auth, "X-Trace": "1" });
      await expect(
        client.getProperty("http-header-fields", z.array(z.string()))
      ).resolves.toStrictEqual([`Authorization: ${auth}`, "X-Trace: 1"]);
      expect(cmdline(client.pid).join(" ")).not.toContain("s3cret-token");
      await expect(client.getProperty("audio-spdif", z.string())).resolves.toBe(
        "ac3,eac3,dts-hd,truehd"
      );
      await expect(client.getProperty("target-colorspace-hint", z.string())).resolves.toBe("auto");
    });

    it("setHttpHeaders refuses a header that would smuggle a second one", async () => {
      const client = await start();
      await expect(setHttpHeaders(client, { Authorization: "x\r\nCookie: y" })).rejects.toThrow(
        new TypeError('invalid HTTP header "Authorization"')
      );
      await expect(
        client.getProperty("http-header-fields", z.array(z.string()))
      ).resolves.toStrictEqual([]);
    });
  });

  describe("a failed command never carries its arguments", () => {
    const TOKEN = "s3cretTok3n9f";
    const records: LogRecord[] = [];

    beforeAll(async () => {
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
    });

    afterAll(async () => {
      await resetLogging();
    });

    /** Everything a caller could print: the message, the error as a value, and its own fields. */
    const printed = (error: Error): string => {
      getLogger(["harakiri", "test"]).error("mpv failed: {error}", { error });

      return [
        String(error),
        inspect(error, { depth: Infinity }),
        JSON.stringify(error),
        ...records.map((record) => defaultTextFormatter(record)),
        ...records.map((record) => inspect(record.properties, { depth: Infinity })),
      ].join("\n");
    };

    it("a loadfile of a transcode URL that mpv rejects names the command, not the URL", async () => {
      records.length = 0;
      const client = await start();
      const url = `http://127.0.0.1:1/videos/x/master.m3u8?api_key=${TOKEN}&PlaySessionId=p`;

      const error = await rejectionOf(client.command("loadfile", url, "no-such-flag"));

      expect(error).toBeInstanceOf(MpvCommandError);
      expect(printed(error)).not.toContain(TOKEN);
      expect(error).toMatchObject({ command: "loadfile", mpvError: "invalid parameter" });
      expect(String(error)).toBe(
        'MpvCommandError: mpv command "loadfile" failed: invalid parameter'
      );
    });

    it("verbose mpv output reaches the log with every token redacted, and starts no yt-dlp", async () => {
      records.length = 0;
      const client = await start([...buildPlaybackArgs(), ...headless, "--msg-level=all=v"]);
      await setHttpHeaders(client, { Authorization: `MediaBrowser Token="${TOKEN}", Client="x"` });

      const { promise: failed, resolve } = Promise.withResolvers<MpvEvent>();
      client.onEvent((event) => {
        if (event.event === "end-file") {
          resolve(event);
        }
      });

      await client.command("loadfile", `http://127.0.0.1:1/v.mkv?api_key=${TOKEN}&static=true`);
      await failed;
      await client.command("sub-add", `http://127.0.0.1:1/s.srt?ApiKey=${TOKEN}`).catch(() => {
        // The sidecar URL is unreachable; only what reached the log matters.
      });
      await expect(client.getProperty("ytdl", z.boolean())).resolves.toBe(false);
      await client.quit();

      const lines = records.map((record) => defaultTextFormatter(record));
      expect(lines.some((line) => line.includes("Set property: http-header-fields"))).toBe(true);
      expect(lines.some((line) => line.includes("api_key=REDACTED"))).toBe(true);
      expect(lines.join("\n")).not.toContain(TOKEN);
      expect(lines.join("\n")).not.toContain("yt-dlp");
    });

    it("a sub-add of a sidecar URL that mpv never answers names the command, not the URL", async () => {
      records.length = 0;
      const client = await start(headless, { requestTimeoutMs: 200 });
      await freeze(client.pid);
      const url = `http://127.0.0.1:1/Videos/x/Subtitles/0/0/Stream.subrip?ApiKey=${TOKEN}`;

      const error = await rejectionOf(client.command("sub-add", url, "auto", "External 1"));

      expect(error).toBeInstanceOf(MpvTimeoutError);
      expect(printed(error)).not.toContain(TOKEN);
      expect(error).toMatchObject({ command: "sub-add", timeoutMs: 200 });
    });
  });

  describe(createLineSplitter, () => {
    it("reassembles messages split across chunks", () => {
      const lines: string[] = [];

      const push = createLineSplitter((line) => {
        lines.push(line);
      });

      push('{"event":"pa');
      push('use"}\n{"request_id":1,');
      push('"error":"success"}\n\n{"event"');
      expect(lines).toStrictEqual(['{"event":"pause"}', '{"request_id":1,"error":"success"}']);
    });
  });

  describe(redactSecrets, () => {
    it("hides Jellyfin tokens in the URLs mpv prints", () => {
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

    it("hides the token in the Authorization header verbose mpv echoes", () => {
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
});

describe("when mpv does not start", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "harakiri-mpv-standin-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  let counter = 0;

  /** A stand-in `mpv` that runs a shell script. */
  const standIn = async (script: string): Promise<string> => {
    counter += 1;
    const file = path.join(dir, `mpv-${counter}`);
    await writeFile(file, `#!/bin/sh\n${script}`);
    await chmod(file, 0o755);

    return file;
  };

  it("the error carries mpv's fatal line", async () => {
    const binary = await standIn(
      'echo "[cplayer] Error parsing option input-gamepad (option not found)"\nexit 1'
    );

    const error = await rejectionOf(spawnMpv({ config: "none", binary }));

    expect(error).toBeInstanceOf(MpvStartError);
    expect(error.message).toBe("Error parsing option input-gamepad (option not found)");
    expect(error).toHaveProperty("exit", { code: 1, signal: null });
  });

  it("with nothing fatal in the output, the message names the exit code", async () => {
    const binary = await standIn("exit 1");
    const error = await rejectionOf(spawnMpv({ config: "none", binary }));

    expect(error).toBeInstanceOf(MpvStartError);
    expect(error.message).toBe("mpv exited before its IPC socket was ready (code 1)");
  });

  it("keeps only the last three fatal lines", async () => {
    const binary = await standIn('for n in 1 2 3 4 5; do echo "Error $n"; done\nexit 1');
    const error = await rejectionOf(spawnMpv({ config: "none", binary }));

    expect(error.message).toBe("Error 3 Error 4 Error 5");
  });

  it("a token in mpv's output never reaches the error", async () => {
    const binary = await standIn(
      'echo "Failed to open http://127.0.0.1:1/v.mkv?api_key=s3cretTok3n9f"\nexit 1'
    );

    const error = await rejectionOf(spawnMpv({ config: "none", binary }));

    expect(error.message).toContain("api_key=REDACTED");
    expect(error.message).not.toContain("s3cretTok3n9f");
  });

  it("a missing binary still fails with ENOENT", async () => {
    const error = await rejectionOf(spawnMpv({ config: "none", binary: path.join(dir, "absent") }));

    expect(error).not.toBeInstanceOf(MpvStartError);
    expect(error).toHaveProperty("code", "ENOENT");
  });

  it("real mpv rejecting an option says which one", async () => {
    const error = await rejectionOf(start(["--vo=null", "--harakiri-no-such-option"]));

    expect(error).toBeInstanceOf(MpvStartError);
    expect(error.message).toContain("harakiri-no-such-option");
  });
});
