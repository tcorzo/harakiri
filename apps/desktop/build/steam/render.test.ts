import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { ARTWORK, renderArtwork } from "./render";

// oxlint-disable-next-line typescript/strict-void-return -- execFile has no promise form; promisify types it through Node's own __promisify__ overload
const run = promisify(execFile);
const here = import.meta.dirname;

const probeSchema = z.object({
  streams: z.tuple([z.object({ width: z.number(), height: z.number(), pix_fmt: z.string() })]),
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
    { encoding: "buffer", maxBuffer: 2 ** 30 }
  );

  return { probe: probeSchema.parse(JSON.parse(stdout)).streams[0], rgba: raw };
};

/** A pixel whose worst channel is further off than this counts as changed. */
const CHANGED_PIXEL = 32;

/**
 * How far two RGBA images are apart: the mean absolute delta over every channel byte, and the
 * share of pixels with some channel more than CHANGED_PIXEL off. Another librsvg anti-aliases
 * edges a little differently; both stay near zero for that, unlike for a moved or recoloured
 * drawing.
 */
const distance = (a: Buffer, b: Buffer) => {
  let sum = 0;
  let changed = 0;

  for (let pixel = 0; pixel < a.length; pixel += 4) {
    let worst = 0;

    for (let channel = pixel; channel < pixel + 4; channel += 1) {
      const delta = Math.abs((a[channel] ?? 0) - (b[channel] ?? 0));
      sum += delta;
      worst = Math.max(worst, delta);
    }

    if (worst > CHANGED_PIXEL) {
      changed += 1;
    }
  }

  return { meanDelta: sum / a.length, changedShare: changed / (a.length / 4) };
};

const fresh = mkdtempSync(path.join(tmpdir(), "harakiri-art-"));

describe("the committed Steam artwork", () => {
  afterAll(() => {
    rmSync(fresh, { recursive: true, force: true });
  });

  it.each(ARTWORK)("$file is $width×$height", async ({ file, width, height, alpha }) => {
    const { probe } = await decode(path.join(here, file));
    expect(probe).toStrictEqual({ width, height, pix_fmt: alpha ? "rgba" : "rgb24" });
  });

  // Same librsvg: both are 0, as the renders are byte-identical. Moving the portrait, wide, logo
  // or icon drawing by 1 px gives a mean of 0.70 to 2.98 and 0.7 % to 2.3 % changed pixels, so the
  // bounds (mean below 0.5, under 0.5 % changed) catch a real change and leave room for
  // anti-aliasing.
  it("is what render.ts draws today, up to anti-aliasing (mise run steam:art)", async () => {
    await renderArtwork(fresh);

    const pairs = await Promise.all(
      ARTWORK.map(async ({ file }) => ({
        file,
        committed: await decode(path.join(here, file)),
        now: await decode(path.join(fresh, file)),
      }))
    );

    for (const { file, committed, now } of pairs) {
      expect(now.rgba).toHaveLength(committed.rgba.length);

      const { meanDelta, changedShare } = distance(committed.rgba, now.rgba);
      expect(meanDelta, `${file}: run mise run steam:art`).toBeLessThan(0.5);
      expect(changedShare, `${file}: run mise run steam:art`).toBeLessThan(0.005);
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
