import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ARTWORK, renderArtwork } from "./render";

const run = promisify(execFile);
const here = import.meta.dirname;

const probeSchema = z.object({
  streams: z.tuple([
    z.object({ width: z.number(), height: z.number(), pix_fmt: z.string() }),
  ]),
});

const decode = async (file: string) => {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,pix_fmt",
    "-of",
    "json",
    file,
  ]);
  const { stdout: raw } = await run(
    "ffmpeg",
    ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    { encoding: "buffer", maxBuffer: 1 << 30 }
  );

  return { probe: probeSchema.parse(JSON.parse(stdout)).streams[0], rgba: raw };
};

const maxChannelDelta = (a: Buffer, b: Buffer) => {
  let max = 0;

  for (let i = 0; i < a.length; i += 1) {
    max = Math.max(max, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  }

  return max;
};

describe("the committed Steam artwork", () => {
  it.each(ARTWORK)("$file is $width×$height", async ({ file, width, height, alpha }) => {
    const { probe } = await decode(path.join(here, file));
    expect(probe).toStrictEqual({ width, height, pix_fmt: alpha ? "rgba" : "rgb24" });
  });

  it("is what render.ts draws today, within ±2 per channel (mise run steam:art)", async () => {
    const fresh = mkdtempSync(path.join(tmpdir(), "harakiri-art-"));
    await renderArtwork(fresh);

    for (const { file } of ARTWORK) {
      const [committed, now] = await Promise.all([
        decode(path.join(here, file)),
        decode(path.join(fresh, file)),
      ]);
      expect(now.rgba.length, `${file}: run mise run steam:art`).toBe(committed.rgba.length);
      expect(maxChannelDelta(committed.rgba, now.rgba), `${file}: run mise run steam:art`).toBeLessThanOrEqual(2);
    }
  });

  it("the logo is see-through around the wordmark", async () => {
    const { rgba } = await decode(path.join(here, "logo.png"));
    // The h's ascender touches the top-left corner, so probe the top-right one (first row, last pixel).
    expect(rgba[1280 * 4 - 1]).toBe(0);
    // ...and the wordmark itself is opaque somewhere.
    expect(rgba.some((v, i) => i % 4 === 3 && v === 255)).toBe(true);
  });
});
