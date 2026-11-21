import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ARTWORK_SOURCES, artworkDir, gridNames, writeArtwork } from "./artwork";
import type { GridKind } from "./artwork";

const ARTWORK = path.resolve(import.meta.dirname, "../../../../build/steam");
const APP_ID = 3_141_592_653;
const KINDS: readonly GridKind[] = ["portrait", "wide", "hero", "logo"];
const UNSIGNED = /unsigned 32-bit integer/u;

describe("artwork", () => {
  it("grid names use the unsigned app ID", () => {
    expect(gridNames(APP_ID)).toStrictEqual({
      portrait: "3141592653p.png",
      wide: "3141592653.png",
      hero: "3141592653_hero.png",
      logo: "3141592653_logo.png",
    });
    expect(() => gridNames(-1)).toThrow(UNSIGNED);
    expect(() => gridNames(2 ** 32)).toThrow(UNSIGNED);
    expect(() => gridNames(1.5)).toThrow(UNSIGNED);
  });

  it("writes the four images into a new grid/", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "harakiri-art-"));

    try {
      const grid = path.join(root, "userdata", "1", "config", "grid");
      const names = gridNames(APP_ID);

      await expect(writeArtwork(ARTWORK, grid, APP_ID)).resolves.toStrictEqual([
        names.portrait,
        names.wide,
        names.hero,
        names.logo,
      ]);

      const copies = await Promise.all(
        KINDS.map(async (kind) => ({
          copy: await readFile(path.join(grid, names[kind])),
          source: await readFile(path.join(ARTWORK, ARTWORK_SOURCES[kind])),
        }))
      );

      for (const { copy, source } of copies) {
        expect(copy).toStrictEqual(source);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never overwrites art already in grid/", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "harakiri-art-"));

    try {
      const grid = path.join(root, "grid");
      const names = gridNames(APP_ID);

      await mkdir(grid, { recursive: true });
      await writeFile(path.join(grid, names.hero), "custom");

      await expect(writeArtwork(ARTWORK, grid, APP_ID)).resolves.toStrictEqual([
        names.portrait,
        names.wide,
        names.logo,
      ]);
      await expect(readFile(path.join(grid, names.hero), "utf-8")).resolves.toBe("custom");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("artworkDir", () => {
    expect(artworkDir({ packaged: true, resourcesPath: "/opt/h/resources", mainDir: "/x" })).toBe(
      "/opt/h/resources/steam"
    );
    expect(
      artworkDir({ packaged: false, resourcesPath: "", mainDir: "/r/apps/desktop/out/main" })
    ).toBe("/r/apps/desktop/build/steam");
  });
});
