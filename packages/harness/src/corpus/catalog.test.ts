import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runToolOrThrow } from "../process";
import { CATALOG, entryPath, LONG_SECONDS, type MovieEntry } from "./catalog";
import { movieNfo } from "./metadata";
import { rleLine, writePgs } from "./pgs";

describe("the corpus catalog", () => {
  test("every entry has its own id and file", () => {
    expect(new Set(CATALOG.map((e) => e.id)).size).toBe(CATALOG.length);
    expect(new Set(CATALOG.map(entryPath)).size).toBe(CATALOG.length);
  });

  test("the base tier covers what the e2e picks by criteria, with no FATE sample", () => {
    const base = CATALOG.filter((e) => e.tier === "base");
    const sdrH264Long = base.filter(
      (e) =>
        e.expect.video.codec === "h264" &&
        e.expect.video.range === "SDR" &&
        e.seconds === LONG_SECONDS,
    );
    expect(sdrH264Long).toHaveLength(2);
    expect(LONG_SECONDS / 60).toBe(6.5);
    expect(
      sdrH264Long.some((e) => e.expect.audio.some((a) => a.codec === "eac3" && a.profile === null)),
    ).toBe(true);
    expect(base.some((e) => e.kind === "episode" && e.expect.video.dvProfile === 5)).toBe(true);
    expect(base.some((e) => e.kind === "movie" && e.expect.video.range === "HDR10")).toBe(true);
    expect(
      base.some(
        (e) =>
          e.expect.audio.length >= 2 &&
          e.expect.subtitles.embedded > 0 &&
          e.expect.subtitles.external > 0,
      ),
    ).toBe(true);
    for (const e of base) {
      expect(e.video.kind).not.toMatch(/^fate/);
      expect(e.audio.every((a) => typeof a.recipe === "string")).toBe(true);
    }
  });

  test("the declared audio matches the recipe's track count", () => {
    for (const e of CATALOG) expect(e.expect.audio).toHaveLength(e.audio.length);
  });
});

describe("the NFO writer", () => {
  test("escapes XML in titles and plots", () => {
    const nfo = movieNfo({
      ...CATALOG.find((e): e is MovieEntry => e.kind === "movie")!,
      meta: { title: "A & B", year: 2000, genres: ["Drama"], plot: "<x>" },
    });
    expect(nfo).toContain("<title>A &amp; B</title>");
    expect(nfo).toContain("<plot>&lt;x&gt;</plot>");
    expect(nfo).toContain("<genre>Drama</genre>");
  });
});

describe("the PGS writer", () => {
  test("codes runs as the HDMV RLE does", () => {
    expect([...rleLine([1, 1])]).toEqual([1, 1, 0, 0]);
    expect([...rleLine(Array(3).fill(0))]).toEqual([0, 3, 0, 0]);
    expect([...rleLine(Array(100).fill(0))]).toEqual([0, 0x40, 100, 0, 0]);
    expect([...rleLine(Array(5).fill(2))]).toEqual([0, 0x85, 2, 0, 0]);
    expect([...rleLine(Array(70).fill(2))]).toEqual([0, 0xc0, 70, 2, 0, 0]);
  });

  // The demuxer reads each segment as a packet: 8 per cue (5 to show it, 3 to clear it).
  test("writes a stream ffprobe reads as a 640x360 PGS track with two cues", () => {
    const dir = mkdtempSync(join(tmpdir(), "corpus-pgs-"));
    try {
      const file = join(dir, "cues.sup");
      writeFileSync(
        file,
        writePgs(640, 360, [
          { start: 0.5, end: 1.5 },
          { start: 2, end: 2.8 },
        ]),
      );
      const { stdout } = runToolOrThrow("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_name,width,height",
        "-count_packets",
        "-show_entries",
        "stream=nb_read_packets",
        "-of",
        "json",
        file,
      ]);
      expect(JSON.parse(stdout).streams).toEqual([
        { codec_name: "hdmv_pgs_subtitle", width: 640, height: 360, nb_read_packets: "16" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
