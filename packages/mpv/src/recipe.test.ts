import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { bundleDirIn, bundledMpvIn, recipeHash, repoRootFrom } from "./bundle";

const roots: string[] = [];

const fakeCheckout = (files?: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), "harakiri-recipe-"));
  roots.push(root);
  mkdirSync(path.join(root, "mpv"));
  writeFileSync(path.join(root, "mpv/versions.env"), "MPV_VERSION=1\n");

  for (const [name, text] of Object.entries(files ?? { a: "one" })) {
    writeFileSync(path.join(root, "mpv", name), text);
  }

  return root;
};

const escapeRegExp = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

describe("harakiri's mpv build", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  describe(recipeHash, () => {
    it("is 16 hex digits and ignores the order the files were written in", () => {
      const first = fakeCheckout({ a: "one", b: "two" });
      const second = fakeCheckout({ b: "two", a: "one" });
      expect(recipeHash(path.join(first, "mpv"))).toMatch(/^[0-9a-f]{16}$/u);
      expect(recipeHash(path.join(first, "mpv"))).toBe(recipeHash(path.join(second, "mpv")));
    });

    it("changes when a byte changes, a file is renamed, or a file is added", () => {
      const base = recipeHash(path.join(fakeCheckout(), "mpv"));

      const bytes = path.join(fakeCheckout({ a: "onf" }), "mpv");
      const renamed = path.join(fakeCheckout({ b: "one" }), "mpv");
      const added = path.join(fakeCheckout(), "mpv");
      mkdirSync(path.join(added, "sub"));
      writeFileSync(path.join(added, "sub/c"), "x");

      const hashes = [bytes, renamed, added].map((dir) => recipeHash(dir));
      expect(new Set([base, ...hashes]).size).toBe(4);
    });

    it("does not change when only a file's mtime changes", () => {
      const root = fakeCheckout();
      const before = recipeHash(path.join(root, "mpv"));
      utimesSync(path.join(root, "mpv/a"), new Date(1_000_000), new Date(2_000_000));
      expect(recipeHash(path.join(root, "mpv"))).toBe(before);
    });
  });

  describe(repoRootFrom, () => {
    it("finds the checkout from a nested dir, and throws above any checkout", () => {
      const root = fakeCheckout();
      const nested = path.join(root, "a", "b");
      mkdirSync(nested, { recursive: true });
      expect(repoRootFrom(nested)).toBe(root);
      const bare = mkdtempSync(path.join(tmpdir(), "harakiri-bare-"));
      roots.push(bare);
      expect(() => repoRootFrom(bare)).toThrow(`No mpv/versions.env above ${bare}`);
    });
  });

  describe(bundledMpvIn, () => {
    it("returns the build for this recipe", () => {
      const root = fakeCheckout();
      const hash = recipeHash(path.join(root, "mpv"));
      const dir = path.join(root, ".cache/mpv", hash);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "mpv"), "");
      expect(bundledMpvIn(root)).toBe(path.join(root, ".cache/mpv", hash, "mpv"));
    });

    it("a missing build throws and names mise run mpv:build", () => {
      const root = fakeCheckout();
      const hash = recipeHash(path.join(root, "mpv"));
      expect(() => bundledMpvIn(root)).toThrow(
        `harakiri's mpv build ${hash} is missing (${path.join(root, ".cache/mpv", hash)}): run \`mise run mpv:build\``
      );
    });

    it("a build for another recipe, or a partial one, is never used", () => {
      const root = fakeCheckout();
      const hash = recipeHash(path.join(root, "mpv"));

      for (const name of ["0000000000000000", `${hash}.partial`]) {
        mkdirSync(path.join(root, ".cache/mpv", name), { recursive: true });
        writeFileSync(path.join(root, ".cache/mpv", name, "mpv"), "");
      }

      expect(() => bundledMpvIn(root)).toThrow("mise run mpv:build");
    });
  });

  describe(bundleDirIn, () => {
    it("this checkout's build dir is under its own .cache/mpv", () => {
      const root = repoRootFrom(import.meta.dirname);
      expect(existsSync(path.join(root, "mpv/versions.env"))).toBe(true);
      expect(bundleDirIn(root)).toMatch(
        new RegExp(String.raw`^${escapeRegExp(root)}/\.cache/mpv/[0-9a-f]{16}$`, "u")
      );
    });
  });
});
