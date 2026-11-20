import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { runToolOrThrow } from "../process";
import { CATALOG, entryPath, LONG_SECONDS } from "./catalog";
import type { MovieEntry } from "./catalog";
import { movieNfo } from "./metadata";
import { rleLine, writePgs } from "./pgs";

const probe = z.object({ streams: z.array(z.record(z.string(), z.unknown())) });

describe("the corpus catalog", () => {
  it("every entry has its own id and file", () => {
    expect(new Set(CATALOG.map((e) => e.id)).size).toBe(CATALOG.length);
    expect(new Set(CATALOG.map(entryPath)).size).toBe(CATALOG.length);
  });

  it("the base tier carries the long SDR H.264 movies the e2e picks", () => {
    const base = CATALOG.filter((e) => e.tier === "base");

    const sdrH264Long = base.filter(
      (e) =>
        e.expect.video.codec === "h264" &&
        e.expect.video.range === "SDR" &&
        e.seconds === LONG_SECONDS
    );

    expect(sdrH264Long).toHaveLength(2);
    expect(LONG_SECONDS / 60).toBe(6.5);
    expect(
      sdrH264Long.some((e) => e.expect.audio.some((a) => a.codec === "eac3" && a.profile === null))
    ).toBe(true);
  });

  it("the base tier covers the HDR, Dolby Vision and subtitle cases the e2e picks", () => {
    const base = CATALOG.filter((e) => e.tier === "base");

    expect(base.some((e) => e.kind === "episode" && e.expect.video.dvProfile === 5)).toBe(true);
    expect(base.some((e) => e.kind === "movie" && e.expect.video.range === "HDR10")).toBe(true);
    expect(
      base.some(
        (e) =>
          e.expect.audio.length >= 2 &&
          e.expect.subtitles.embedded > 0 &&
          e.expect.subtitles.external > 0
      )
    ).toBe(true);
  });

  it("the base tier uses no FATE sample", () => {
    for (const e of CATALOG.filter((entry) => entry.tier === "base")) {
      expect(e.video.kind).not.toMatch(/^fate/u);
      expect(e.audio.filter((a) => !z.string().safeParse(a.recipe).success)).toStrictEqual([]);
    }
  });

  it("the declared audio matches the recipe's track count", () => {
    for (const e of CATALOG) {
      expect(e.expect.audio).toHaveLength(e.audio.length);
    }
  });
});

describe("the NFO writer", () => {
  it("escapes XML in titles and plots", () => {
    const movie = CATALOG.find((e): e is MovieEntry => e.kind === "movie");

    if (movie === undefined) {
      throw new Error("the catalog has no movie");
    }

    const nfo = movieNfo({
      ...movie,
      meta: { title: "A & B", year: 2000, genres: ["Drama"], plot: "<x>" },
    });

    expect(nfo).toContain("<title>A &amp; B</title>");
    expect(nfo).toContain("<plot>&lt;x&gt;</plot>");
    expect(nfo).toContain("<genre>Drama</genre>");
  });
});

describe("the PGS writer", () => {
  it("codes runs as the HDMV RLE does", () => {
    expect([...rleLine([1, 1])]).toStrictEqual([1, 1, 0, 0]);
    expect([...rleLine(Array.from({ length: 3 }, () => 0))]).toStrictEqual([0, 3, 0, 0]);
    expect([...rleLine(Array.from({ length: 100 }, () => 0))]).toStrictEqual([0, 0x40, 100, 0, 0]);
    expect([...rleLine(Array.from({ length: 5 }, () => 2))]).toStrictEqual([0, 0x85, 2, 0, 0]);
    expect([...rleLine(Array.from({ length: 70 }, () => 2))]).toStrictEqual([0, 0xc0, 70, 2, 0, 0]);
  });

  // The demuxer reads each segment as a packet: 8 per cue (5 to show it, 3 to clear it).
  it("writes a stream ffprobe reads as a 640x360 PGS track with two cues", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "corpus-pgs-"));

    try {
      const file = path.join(dir, "cues.sup");
      writeFileSync(
        file,
        writePgs(640, 360, [
          { start: 0.5, end: 1.5 },
          { start: 2, end: 2.8 },
        ])
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

      expect(probe.parse(JSON.parse(stdout)).streams).toStrictEqual([
        { codec_name: "hdmv_pgs_subtitle", width: 640, height: 360, nb_read_packets: "16" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
