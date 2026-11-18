import { match } from "ts-pattern";

import type { EpisodeEntry, Metadata, MovieEntry } from "./catalog";

/** Kodi-style NFO files, which Jellyfin's local metadata reader takes with no internet access. */

const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const tag = (name: string, value: string | number) =>
  `  <${name}>${escape(String(value))}</${name}>`;

const xml = (root: string, lines: readonly string[]) =>
  `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<${root}>\n${lines.join("\n")}\n</${root}>\n`;

function common(meta: Metadata): string[] {
  return [
    tag("title", meta.title),
    tag("originaltitle", meta.title),
    tag("sorttitle", meta.title),
    tag("year", meta.year),
    tag("premiered", `${meta.year}-01-01`),
    tag("plot", meta.plot),
    ...meta.genres.map((genre) => tag("genre", genre)),
    tag("studio", "harakiri corpus"),
  ];
}

export function movieNfo(entry: MovieEntry): string {
  return xml("movie", common(entry.meta));
}

export function seriesNfo(meta: Metadata): string {
  return xml("tvshow", [...common(meta), tag("season", 1), tag("status", "Ended")]);
}

export function episodeNfo(entry: EpisodeEntry, seriesYear: number): string {
  return xml("episodedetails", [
    tag("title", entry.title),
    tag("showtitle", entry.series),
    tag("season", entry.season),
    tag("episode", entry.episode),
    tag("aired", `${seriesYear}-01-${String(entry.episode).padStart(2, "0")}`),
    tag("plot", entry.plot),
  ]);
}

/** A colour pair from an index: distinct per item, the same on every run. */
export function palette(index: number): { base: string; accent: string } {
  const hue = (index * 137.508) % 360; // golden angle
  return { base: hsl(hue, 0.45, 0.28), accent: hsl((hue + 160) % 360, 0.7, 0.6) };
}

function hsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `0x${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

export type Artwork = "poster" | "backdrop" | "logo" | "thumb";

/**
 * A lavfi graph for one artwork PNG: flat shapes so the files stay a few KB and the frames tell
 * items apart. Logos are transparent, as Jellyfin's clear logos are.
 */
export function artworkGraph(kind: Artwork, index: number): string {
  const { base, accent } = palette(index);
  const bar = (x: number, y: number, w: number, h: number, color: string, replace = false) =>
    `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=fill${replace ? ":replace=1" : ""}`;
  const stripes = (width: number, height: number) =>
    Array.from({ length: 1 + (index % 4) }, (_, i) =>
      bar(0, Math.round(height * (0.55 + i * 0.08)), width, Math.round(height * 0.04), accent)
    );
  return match(kind)
    .with("poster", () =>
      [`color=c=${base}:s=300x450:d=1`, bar(30, 40, 240, 120, accent), ...stripes(300, 450)].join(
        ","
      )
    )
    .with("backdrop", () =>
      [
        `color=c=${base}:s=960x540:d=1`,
        bar(60 + (index % 5) * 120, 80, 240, 240, accent),
        ...stripes(960, 540),
      ].join(",")
    )
    .with("thumb", () =>
      [`color=c=${base}:s=480x270:d=1`, bar(40, 40, 120, 120, accent), ...stripes(480, 270)].join(
        ","
      )
    )
    .with("logo", () =>
      [
        "color=c=black@0.0:s=400x120:d=1",
        "format=rgba",
        bar(10, 30, 380, 60, `${accent}@1.0`, true),
        bar(30 + (index % 6) * 50, 45, 40, 30, "black@0.0", true),
      ].join(",")
    )
    .exhaustive();
}
