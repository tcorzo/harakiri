// @vitest-environment node
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { bundledMpv } from "./bundle";

// The guest has only what dev/vm/provision.sh installs, so these prove that its package list covers
// mpv/host-libs.txt now that no system mpv pulls those libraries in.
describe("harakiri's mpv build in the guest", () => {
  it("the guest has no mpv of its own", () => {
    expect(execFileSync("sh", ["-c", "command -v mpv || echo none"], { encoding: "utf-8" })).toBe(
      "none\n"
    );
  });

  it("every host library the build needs resolves in the guest", () => {
    const ldd = execFileSync("ldd", [bundledMpv()], { encoding: "utf-8" });
    expect(ldd.split("\n").filter((line) => line.includes("not found"))).toStrictEqual([]);
  });

  it("runs in the guest with only the guest's own libraries", () => {
    expect(
      execFileSync(bundledMpv(), ["--no-config", "--version"], { encoding: "utf-8", env: {} })
    ).toMatch(/^mpv v0\.42\.0 /mu);
  });
});
