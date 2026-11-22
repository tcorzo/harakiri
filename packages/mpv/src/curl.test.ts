import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createReadStream, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { OutgoingHttpHeaders, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { bundledMpv } from "./bundle";
import { spawnMpv } from "./client";
import type { MpvClient } from "./client";

const START_SECONDS = 10;

let dir: string;
let server: Server;
let url: string;
const clients: MpvClient[] = [];

/** A static file server that answers byte ranges with 206, as Jellyfin's static stream does. */
const serveRanges = async (file: string): Promise<{ server: Server; url: string }> => {
  const { size } = statSync(file);

  const ranged = createServer((request, response) => {
    const range = /^bytes=(?<from>\d+)-(?<to>\d*)$/u.exec(request.headers.range ?? "")?.groups;
    const from = range === undefined ? 0 : Number(range.from);
    const to = range?.to === undefined || range.to === "" ? size - 1 : Number(range.to);

    const headers: OutgoingHttpHeaders = {
      "Accept-Ranges": "bytes",
      "Content-Type": "video/x-matroska",
      "Content-Length": to - from + 1,
    };

    if (range !== undefined) {
      headers["Content-Range"] = `bytes ${from}-${to}/${size}`;
    }

    response.writeHead(range === undefined ? 200 : 206, headers);
    createReadStream(file, { start: from, end: to }).pipe(response);
  });

  ranged.listen(0, "127.0.0.1");
  await once(ranged, "listening");
  const { port } = z.custom<AddressInfo>().parse(ranged.address());

  return { server: ranged, url: `http://127.0.0.1:${port}/clip.mkv` };
};

describe("harakiri's mpv reading HTTP through libcurl", () => {
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "harakiri-curl-test-"));
    const clip = path.join(dir, "clip.mkv");
    // Matroska with its Cues at the end, which mpv reads only once a seek needs them.
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=duration=20:size=320x180:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=duration=20",
      "-c:v",
      "ffv1",
      "-c:a",
      "flac",
      "-shortest",
      clip,
    ]);
    ({ server, url } = await serveRanges(clip));
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map(async (client) => await client.quit()));
  });

  afterAll(async () => {
    server.closeAllConnections();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });

  // libcurl 8.18.0 kept an easy handle paused after it was removed and added again (curl #20641),
  // so the seek to the Cues never connected and playback stalled at the start position. A small
  // curl buffer fills at once, so the transfer is always paused when the seek comes.
  it("plays on from a start position whose seek reads the Cues", async () => {
    const client = await spawnMpv({
      config: "none",
      binary: bundledMpv(),
      args: ["--vo=null", "--ao=null", "--curl-buffer-size=64KiB"],
    });

    clients.push(client);

    await client.command("loadfile", url, "replace", "-1", `start=${START_SECONDS}`);

    await vi.waitFor(
      async () => {
        const position = await client.getProperty("time-pos", z.number().nullable());

        expect(position ?? 0).toBeGreaterThanOrEqual(START_SECONDS + 1);
      },
      // A pass takes about a second; the margin is for a loaded machine
      { timeout: 15_000, interval: 100 }
    );
  }, 30_000);
});
