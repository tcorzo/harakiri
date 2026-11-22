import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inGuest, requireGuest } from "./guest";

describe(requireGuest, () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "harakiri-guest-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("outside the guest, throws and names the task that runs the tier", () => {
    expect(() => {
      requireGuest("mise run test:platform", path.join(dir, "absent"));
    }).toThrow("This test runs inside the dev/vm guest. Run it with `mise run test:platform`.");
  });

  it("passes when the marker exists", () => {
    writeFileSync(path.join(dir, "marker"), "harakiri dev/vm guest\n");
    expect(() => {
      requireGuest("mise run test:platform", path.join(dir, "marker"));
    }).not.toThrow();
    expect(inGuest(path.join(dir, "marker"))).toBe(true);
  });
});
