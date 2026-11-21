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
const argsFor = (spec: ArtworkSpec): string[] => {
  switch (spec.file) {
    case "portrait.png":
      return [
        ...canvas(spec),
        ...icon(360),
        ...wordmark(480),
        "-filter_complex",
        "[0][1]overlay=(W-w)/2:250[a];[a][2]overlay=(W-w)/2:660,format=rgb24",
      ];
    case "wide.png":
      return [
        ...canvas(spec),
        ...icon(240),
        ...wordmark(440),
        "-filter_complex",
        "[0][1]overlay=110:(H-h)/2[a];[a][2]overlay=400:(H-h)/2,format=rgb24",
      ];
    case "hero.png":
      // Valve: no text on the hero; Steam layers the logo over it. The crane fills about 64% of the
      // icon's height, so a 580px icon keeps the glyph inside the centred 860x380 safe area.
      return [
        ...canvas(spec),
        ...icon(580),
        "-filter_complex",
        "[0][1]overlay=(W-w)/2:(H-h)/2,format=rgb24",
      ];
    case "logo.png":
      return [...wordmark(spec.width), "-vf", "format=rgba"];
    case "icon.png":
      return [...icon(spec.width), "-vf", "format=rgba"];
  }
};

/** Runs ffmpeg once per image, writing every ARTWORK file into outDir. */
export const renderArtwork = async (outDir: string): Promise<void> => {
  mkdirSync(outDir, { recursive: true });

  for (const spec of ARTWORK) {
    await run("ffmpeg", [
      "-v",
      "error",
      "-y",
      ...argsFor(spec),
      "-frames:v",
      "1",
      path.join(outDir, spec.file),
    ]);
  }
};

if (import.meta.main) {
  await renderArtwork(here);
}
