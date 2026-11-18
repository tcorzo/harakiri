import { describe, expect, test } from "vitest";

import { listsAll, versionAtLeast } from "./doctor";
import { compareVersions, parseVersion } from "./version";

const exited = (stdout: string, code = 0) =>
  ({ kind: "exited", code, stdout, stderr: "" }) as const;

const MPV_VERSION = `mpv v0.41.0 Copyright © 2000-2025 mpv/MPlayer/mplayer2 projects
libplacebo version: v7.360.1
FFmpeg version: 8.0.1 (runtime 8.1.3)`;

describe("parseVersion", () => {
  test("reads mpv and libplacebo versions from `mpv --version`", () => {
    expect(parseVersion(MPV_VERSION, /^mpv v?/m)).toEqual([0, 41, 0]);
    expect(parseVersion(MPV_VERSION, /^libplacebo version: v?/m)).toEqual([7, 360, 1]);
  });

  test("pads missing components with zero and returns null when the prefix is absent", () => {
    expect(parseVersion("weston 15", /weston /)).toEqual([15, 0, 0]);
    expect(parseVersion("weston 15.0.1", /kwin /)).toBeNull();
  });
});

describe("compareVersions", () => {
  test("orders numerically per component, not lexically", () => {
    expect(compareVersions([0, 9, 0], [0, 41, 0])).toBe(-1);
    expect(compareVersions([15, 0, 1], [15, 0, 0])).toBe(1);
    expect(compareVersions([0, 41, 0], [0, 41, 0])).toBe(0);
  });
});

describe("check judges", () => {
  const mpv = versionAtLeast(/^mpv v?/m, [0, 41, 0]);

  test("accepts mpv 0.41.0 and flags 0.40.0 as outdated", () => {
    expect(mpv(exited(MPV_VERSION))).toEqual({ status: "ok", detail: "0.41.0" });
    expect(mpv(exited("mpv v0.40.0 Copyright"))).toEqual({
      status: "outdated",
      detail: "0.40.0 < 0.41.0",
    });
  });

  test("reports a tool that is not on PATH or fails", () => {
    expect(mpv({ kind: "not-found", command: "mpv" })).toEqual({
      status: "missing",
      detail: "mpv is not on PATH",
    });
    expect(mpv(exited("", 127))).toEqual({ status: "missing", detail: "exited 127" });
  });

  test("names the encoders an ffmpeg listing lacks", () => {
    const encoders = listsAll(
      ["ac3", "eac3", "dca"],
      (name) => new RegExp(`^\\s*\\S+\\s+${name}\\s`, "m")
    );

    const listing = ` A....D ac3                  ATSC A/52A (AC-3)\n A....D eac3                 ATSC A/52 E-AC-3\n`;
    expect(encoders(exited(listing))).toEqual({ status: "missing", detail: "missing dca" });
    expect(encoders(exited(`${listing} A..X.D dca                  DCA\n`))).toEqual({
      status: "ok",
      detail: "ac3, eac3, dca",
    });
  });
});
