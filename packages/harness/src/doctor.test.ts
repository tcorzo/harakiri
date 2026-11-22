import { describe, expect, it } from "vitest";

import { CHECKS, listsAll, succeeds, versionAtLeast } from "./doctor";
import { compareVersions, parseVersion } from "./version";

const exited = (stdout: string, code = 0) =>
  ({ kind: "exited", code, stdout, stderr: "" }) as const;

describe(parseVersion, () => {
  it("reads a version after its prefix", () => {
    expect(parseVersion("weston 15.0.0", /weston /u)).toStrictEqual([15, 0, 0]);
    expect(parseVersion("podman version 5.6.2", /podman version /u)).toStrictEqual([5, 6, 2]);
  });

  it("pads missing components with zero and returns null when the prefix is absent", () => {
    expect(parseVersion("weston 15", /weston /u)).toStrictEqual([15, 0, 0]);
    expect(parseVersion("weston 15.0.1", /kwin /u)).toBeNull();
  });
});

describe(compareVersions, () => {
  it("orders numerically per component, not lexically", () => {
    expect(compareVersions([14, 9, 0], [15, 0, 0])).toBe(-1);
    expect(compareVersions([15, 0, 1], [15, 0, 0])).toBe(1);
    expect(compareVersions([15, 0, 0], [15, 0, 0])).toBe(0);
  });
});

describe("check judges", () => {
  const weston = versionAtLeast(/weston /u, [15, 0, 0]);

  it("accepts weston 15.0.0 and flags 14.0.2 as outdated", () => {
    expect(weston(exited("weston 15.0.0"))).toStrictEqual({ status: "ok", detail: "15.0.0" });
    expect(weston(exited("weston 14.0.2"))).toStrictEqual({
      status: "outdated",
      detail: "14.0.2 < 15.0.0",
    });
  });

  it("reports a tool that is not on PATH or fails", () => {
    expect(weston({ kind: "not-found", command: "weston" })).toStrictEqual({
      status: "missing",
      detail: "weston is not on PATH",
    });
    expect(weston(exited("", 127))).toStrictEqual({ status: "missing", detail: "exited 127" });
  });

  it("names the encoders an ffmpeg listing lacks", () => {
    const encoders = listsAll(
      ["ac3", "eac3", "dca"],
      (name) => new RegExp(`^\\s*\\S+\\s+${name}\\s`, "mu")
    );

    const listing = ` A....D ac3                  ATSC A/52A (AC-3)\n A....D eac3                 ATSC A/52 E-AC-3\n`;
    expect(encoders(exited(listing))).toStrictEqual({ status: "missing", detail: "missing dca" });
    expect(encoders(exited(`${listing} A..X.D dca                  DCA\n`))).toStrictEqual({
      status: "ok",
      detail: "ac3, eac3, dca",
    });
  });

  it("passes a probe that exits 0 and names the fix when it exits non-zero", () => {
    const kvm = succeeds("read-write", "not read-write: join the kvm group");

    expect(kvm(exited(""))).toStrictEqual({ status: "ok", detail: "read-write" });
    expect(kvm(exited("", 1))).toStrictEqual({
      status: "missing",
      detail: "not read-write: join the kvm group",
    });
    expect(kvm({ kind: "not-found", command: "sh" })).toStrictEqual({
      status: "missing",
      detail: "sh is not on PATH",
    });
  });
});

describe("the doctor check list", () => {
  it("checks the harness tools and KVM only: no mpv, and podman and KVM are required", () => {
    expect(CHECKS.map((c) => c.label)).toStrictEqual([
      "ffmpeg filter libplacebo",
      "ffmpeg bitstream filter dovi_rpu",
      "ffmpeg encoders",
      "ffmpeg decoder librsvg",
      "kwin_wayland",
      "weston",
      "podman",
      "dovi_tool",
      "hdr10plus_tool",
      "/dev/kvm (e2e and test:platform)",
    ]);
    expect(CHECKS.find((c) => c.label === "podman")?.required).toBe(true);
    expect(CHECKS.find((c) => c.label.startsWith("/dev/kvm"))?.required).toBe(true);
  });
});
