import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { bundledMpv } from "./bundle";
import { mpvBundleChecks, mpvBundleProblems, mpvCheckImage, mpvInvocation } from "./release-check";

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

describe("how the checks start the shipped mpv", () => {
  it("runs it directly, with an empty environment, when HARAKIRI_MPV_CHECK_IMAGE is unset", () => {
    expect(
      mpvInvocation("/tmp/x/resources/mpv", ["--version"], mpvCheckImage({ HOME: "/h" }))
    ).toStrictEqual({
      file: "/tmp/x/resources/mpv/mpv",
      args: ["--no-config", "--version"],
      env: {},
    });
  });

  it("runs it directly when HARAKIRI_MPV_CHECK_IMAGE is empty", () => {
    expect(mpvCheckImage({ HARAKIRI_MPV_CHECK_IMAGE: " " })).toBeUndefined();
  });

  it("runs it in podman on the image, with no network and the bundle read-only, when HARAKIRI_MPV_CHECK_IMAGE is set", () => {
    expect(
      mpvInvocation(
        "/tmp/x/resources/mpv",
        ["--vd=help"],
        mpvCheckImage({ HARAKIRI_MPV_CHECK_IMAGE: "localhost/harakiri-mpv-check" })
      )
    ).toStrictEqual({
      file: "podman",
      args: [
        "run",
        "--rm",
        "--pull=never",
        "--network=none",
        "--memory=1g",
        "--volume=/tmp/x/resources/mpv:/opt/harakiri-mpv:ro,Z",
        "localhost/harakiri-mpv-check",
        "/opt/harakiri-mpv/mpv",
        "--no-config",
        "--vd=help",
      ],
      env: undefined,
    });
  });
});

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

  it("names the loader's error when mpv cannot start", () => {
    const shipped = shippedCopy();

    const loaderError =
      "/opt/harakiri-mpv/mpv: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.43' not found (required by /opt/harakiri-mpv/lib/libcurl.so.4)";

    // A stand-in that fails as the loader does, on stderr with status 127.
    writeFileSync(path.join(shipped, "mpv-error.txt"), `${loaderError}\n`);
    rmSync(path.join(shipped, "mpv"));
    writeFileSync(
      path.join(shipped, "mpv"),
      '#!/bin/sh\nread -r line < "$0-error.txt"\necho "$line" >&2\nexit 127\n',
      { mode: 0o755 }
    );

    const runs = mpvBundleChecks(shipped, built()).find((check) => check.name === "mpv runs");

    expect(runs?.problems).toStrictEqual([
      `mpv --version failed: ${loaderError}`,
      `mpv -v --version failed: ${loaderError}`,
    ]);
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
