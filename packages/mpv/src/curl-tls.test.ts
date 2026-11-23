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
const play = async (
  env: Record<string, string>,
  ...args: string[]
): Promise<{ code: number; log: string }> => {
  // the host's own environment, minus the variables that would point OpenSSL at a trust store
  const { SSL_CERT_FILE: _file, SSL_CERT_DIR: _dir, ...inherited } = process.env;

  // --ytdl=no: on a failed load mpv's ytdl hook would try the URL again through yt-dlp
  const argv = ["--no-config", "--ytdl=no", "--vo=null", "--ao=null", "--length=1", ...args, url];

  try {
    const { stdout, stderr } = await run(bundledMpv(), argv, {
      timeout: 20_000,
      env: { ...inherited, ...env },
    });

    return { code: 0, log: stdout + stderr };
  } catch (error) {
    const failed = z
      .object({ code: z.number(), stdout: z.string(), stderr: z.string() })
      .parse(error);

    return { code: failed.code, log: failed.stdout + failed.stderr };
  }
};

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

  it("refuses a certificate the host does not trust, asking the host's OpenSSL for its trust store", async () => {
    const { code, log } = await play({}, "--msg-level=curl=trace");

    expect(code).not.toBe(0);
    expect(log).toContain("[curl] TLS certificate verification failed.");
    expect(log).toContain("OpenSSL default paths (fallback)");
    expect(log).not.toContain("CAfile:");
  });

  it("trusts what the host's OpenSSL is told to trust (SSL_CERT_FILE), with no --tls-ca-file", async () => {
    const { code, log } = await play({ SSL_CERT_FILE: CERT });

    expect(log).toContain("Exiting... (End of file)");
    expect(code).toBe(0);
  });

  it("plays the same URL once that certificate is trusted, so verification really ran", async () => {
    const { code, log } = await play({}, `--tls-ca-file=${CERT}`);

    expect(log).toContain("Exiting... (End of file)");
    expect(code).toBe(0);
  });
});
