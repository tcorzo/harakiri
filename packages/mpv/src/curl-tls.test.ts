import { execFile, execFileSync } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:https";
import type { Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { bundledMpv } from "./bundle";

// oxlint-disable-next-line typescript/strict-void-return -- execFile has no promise form; promisify types it through Node's own __promisify__ overload
const run = promisify(execFile);

// Test-only: a self-signed pair for 127.0.0.1, valid until 2126.
const CERT = path.join(import.meta.dirname, "fixtures/tls/loopback.crt");
const KEY = path.join(import.meta.dirname, "fixtures/tls/loopback.key");

let dir: string;
let clip: Buffer;
let server: Server;
let url: string;

/** Plays `url` for a second with the bundled mpv; resolves with the exit code and everything mpv logged. */
const play = async (...args: string[]): Promise<{ code: number; log: string }> => {
  // --ytdl=no: on a failed load mpv's ytdl hook would try the URL again through yt-dlp
  const argv = ["--no-config", "--ytdl=no", "--vo=null", "--ao=null", "--length=1", ...args, url];

  try {
    const { stdout, stderr } = await run(bundledMpv(), argv, { timeout: 20_000 });

    return { code: 0, log: stdout + stderr };
  } catch (error) {
    const failed = z
      .object({ code: z.number(), stdout: z.string(), stderr: z.string() })
      .parse(error);

    return { code: failed.code, log: failed.stdout + failed.stderr };
  }
};

/** The CA bundle the build says its libcurl reads by default (mpv/build.sh, CURL_CA_BUNDLE). */
const caBundle = (): string =>
  z
    .object({ caBundle: z.string() })
    .parse(
      JSON.parse(readFileSync(path.join(path.dirname(bundledMpv()), "manifest.json"), "utf-8"))
    ).caBundle;

describe("harakiri's mpv reading https through libcurl", () => {
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "harakiri-curl-tls-test-"));
    const file = path.join(dir, "clip.mkv");
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
      file,
    ]);
    clip = readFileSync(file);

    server = createServer({ cert: readFileSync(CERT), key: readFileSync(KEY) }, (_, response) => {
      response.writeHead(200, {
        "Content-Type": "video/x-matroska",
        "Content-Length": clip.length,
      });
      response.end(clip);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = z.custom<AddressInfo>().parse(server.address());
    url = `https://127.0.0.1:${port}/clip.mkv`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a certificate its CA bundle does not trust, reading the bundle the build names", async () => {
    const { code, log } = await play("--msg-level=curl=trace");

    expect(code).not.toBe(0);
    expect(log).toContain("[curl] TLS certificate verification failed.");
    // libcurl's verbose handshake names the trust store it loaded: the build's CA bundle, and no
    // CA dir (CURL_CA_PATH=none, so no CApath line)
    expect(log).toContain(`CAfile: ${caBundle()}`);
    expect(log).not.toContain("CApath:");
    expect(log).not.toContain("Exiting... (End of file)");
  });

  it("plays the same URL once that certificate is trusted, so verification really ran", async () => {
    const { code, log } = await play(`--tls-ca-file=${CERT}`);

    expect(log).toContain("Exiting... (End of file)");
    expect(code).toBe(0);
  });
});
