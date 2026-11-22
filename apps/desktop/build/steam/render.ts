#!/usr/bin/env bun
/**
 * Renders the Steam library artwork from the README's vectors with ffmpeg's librsvg decoder:
 *
 *   bun apps/desktop/build/steam/render.ts   (mise run steam:art) renders into this directory
 *
 * The PNGs are committed and packed in the AppImage (extraResources); render.test.ts fails when
 * they drift from what this file draws.
 */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { match } from "ts-pattern";

export interface ArtworkSpec {
  readonly file: "portrait.png" | "wide.png" | "hero.png" | "logo.png" | "icon.png";
  readonly width: number;
  readonly height: number;
  /** rgba when true, rgb24 otherwise. */
  readonly alpha: boolean;
}

export const ARTWORK: readonly ArtworkSpec[] = [
  { file: "portrait.png", width: 600, height: 900, alpha: false },
  { file: "wide.png", width: 920, height: 430, alpha: false },
  { file: "hero.png", width: 3840, height: 1240, alpha: false },
  { file: "logo.png", width: 1280, height: 308, alpha: true },
  { file: "icon.png", width: 256, height: 256, alpha: true },
];

// oxlint-disable-next-line typescript/strict-void-return -- execFile has no promise form; promisify types it through Node's own __promisify__ overload
const run = promisify(execFile);
const here = import.meta.dirname;
const assets = path.resolve(here, "../../../../docs/assets/readme");
const iconSvg = path.join(assets, "icon.svg");
const wordmarkSvg = path.join(assets, "logo-dark.svg");
const BACKGROUND = "0x0a0605";

const canvas = ({ width, height }: ArtworkSpec) => [
  "-f",
  "lavfi",
  "-i",
  `color=c=${BACKGROUND}:s=${width}x${height}`,
];

const icon = (size: number) => ["-width", String(size), "-height", String(size), "-i", iconSvg];
const wordmark = (width: number) => ["-width", String(width), "-i", wordmarkSvg];

/** The ffmpeg arguments (without the output path) that draw one image. */
const argsFor = (spec: ArtworkSpec): string[] =>
  // Layout verdict (impeccable critique against PRODUCT.md: restraint, gravity, the library is the
  // hero): one crane, one wordmark, no ornament on the house-black ground. The visible groups are
  // balanced optically, not by box: portrait group centre sits just below the middle, wide group
  // has equal ~130px margins (the icon svg carries its own padding).
  match(spec.file)
    .with("portrait.png", () => [
      ...canvas(spec),
      ...icon(360),
      ...wordmark(480),
      "-filter_complex",
      "[0][1]overlay=(W-w)/2:220[a];[a][2]overlay=(W-w)/2:630,format=rgb24",
    ])
    .with("wide.png", () => [
      ...canvas(spec),
      ...icon(240),
      ...wordmark(440),
      "-filter_complex",
      "[0][1]overlay=60:(H-h)/2[a];[a][2]overlay=350:(H-h)/2,format=rgb24",
    ])
    // Valve: no text on the hero; Steam layers the logo over it. The crane fills about 64% of the
    // icon's height, so a 580px icon keeps the glyph inside the centred 860x380 safe area.
    .with("hero.png", () => [
      ...canvas(spec),
      ...icon(580),
      "-filter_complex",
      "[0][1]overlay=(W-w)/2:(H-h)/2,format=rgb24",
    ])
    .with("logo.png", () => [...wordmark(spec.width), "-vf", "format=rgba"])
    .with("icon.png", () => [...icon(spec.width), "-vf", "format=rgba"])
    .exhaustive();

/** Runs ffmpeg once per image, all at once, writing every ARTWORK file into outDir. */
export const renderArtwork = async (outDir: string): Promise<void> => {
  mkdirSync(outDir, { recursive: true });

  await Promise.all(
    ARTWORK.map(
      async (spec) =>
        await run("ffmpeg", [
          "-v",
          "error",
          "-y",
          ...argsFor(spec),
          "-frames:v",
          "1",
          path.join(outDir, spec.file),
        ])
    )
  );
};

if (import.meta.main) {
  await renderArtwork(here);
}
