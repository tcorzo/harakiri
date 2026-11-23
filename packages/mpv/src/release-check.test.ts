import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { bundledMpv } from "./bundle";
import { mpvBundleProblems } from "./release-check";

// The real build in .cache/mpv/<recipe-hash>. With none, bundledMpv() throws naming `mise run mpv:build`.
// The tests only read it: each one checks a copy in its own temp dir.
const built = (): string => path.dirname(bundledMpv());

const temps: string[] = [];

/** A copy of the built bundle, as `resources/mpv/` holds it in the AppImage. */
const shippedCopy = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "harakiri-release-check-"));
  temps.push(dir);
  const shipped = path.join(dir, "mpv");
  cpSync(built(), shipped, { recursive: true, verbatimSymlinks: true });

  return shipped;
};

describe("the mpv an AppImage ships", () => {
  afterAll(() => {
    for (const dir of temps) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes every check when it is the recipe's build", () => {
    expect(mpvBundleProblems(shippedCopy(), built())).toStrictEqual([]);
  });

  it("fails when a license or a library is missing", () => {
    const shipped = shippedCopy();
    rmSync(path.join(shipped, "licenses/harfbuzz"), { recursive: true });
    rmSync(path.join(shipped, "lib/libass.so.9"));

    const problems = mpvBundleProblems(shipped, built());

    expect(problems).toContain("harfbuzz: no license file in licenses/harfbuzz/");
    expect(problems).toContain("lib/libass.so.9: differs from the recipe's build");
  });
});
