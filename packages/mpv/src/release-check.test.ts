import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { bundledMpv } from "./bundle";
import { mpvBundleChecks, mpvBundleProblems } from "./release-check";

// The real build in .cache/mpv/<recipe-hash>. With none, bundledMpv() throws naming `mise run mpv:build`.
// The tests only read it: each one checks a copy in its own temp dir.
const built = (): string => path.dirname(bundledMpv());

const temps: string[] = [];

/** A new empty temp dir, removed after the tests. */
const tempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "harakiri-release-check-"));
  temps.push(dir);

  return dir;
};

/** A copy of the built bundle, as `resources/mpv/` holds it in the AppImage. */
const shippedCopy = (): string => {
  const shipped = path.join(tempDir(), "mpv");
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

  it("fails on a file the recipe's build does not have", () => {
    const shipped = shippedCopy();
    writeFileSync(path.join(shipped, "extra.txt"), "not built\n");

    expect(mpvBundleProblems(shipped, built())).toContain("extra.txt: not in the recipe's build");
  });

  it("fails on a symlink instead of following it", () => {
    const shipped = shippedCopy();
    symlinkSync("lib", path.join(shipped, "share"));

    expect(mpvBundleProblems(shipped, built())).toContain("share: not a regular file");
  });

  it("fails every check, without throwing, when the AppImage has no resources/mpv", () => {
    const checks = mpvBundleChecks(path.join(tempDir(), "mpv"), built());
    const problems = ["resources/mpv: not in the AppImage"];

    expect(checks).toStrictEqual([
      { name: "mpv is this recipe's build", problems },
      { name: "mpv runs", problems },
      { name: "mpv decoders", problems },
      { name: "mpv host libs", problems },
      { name: "mpv licenses", problems },
    ]);
  });

  it("fails the checks against the build, without throwing, when the current recipe has none", () => {
    const checks = mpvBundleChecks(shippedCopy(), path.join(tempDir(), "0123456789abcdef"));
    const problems = ["0123456789abcdef: no build of the current recipe; run `mise run mpv:build`"];

    expect(checks).toStrictEqual([
      { name: "mpv is this recipe's build", problems },
      { name: "mpv runs", problems },
      { name: "mpv decoders", problems: [] },
      { name: "mpv host libs", problems: [] },
      { name: "mpv licenses", problems: [] },
    ]);
  });
});
