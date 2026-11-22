// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { resolveMpvBinary } from "./mpv-binary";

describe("the mpv the app plays with", () => {
  it("HARAKIRI_MPV wins, packaged or not, and the build is never looked up", () => {
    const bundled = vi.fn<() => string>(() => "/checkout/.cache/mpv/0123456789abcdef/mpv");

    expect(resolveMpvBinary({ override: "/opt/mpv-git/mpv", packaged: false, bundled })).toBe(
      "/opt/mpv-git/mpv"
    );
    expect(resolveMpvBinary({ override: "/opt/mpv-git/mpv", packaged: true, bundled })).toBe(
      "/opt/mpv-git/mpv"
    );
    expect(bundled).not.toHaveBeenCalled();
  });

  it("a packaged app keeps mpv from PATH until it ships its own (Phase 8)", () => {
    const bundled = vi.fn<() => string>(() => "/never");

    expect(resolveMpvBinary({ override: undefined, packaged: true, bundled })).toBe("mpv");
    expect(bundled).not.toHaveBeenCalled();
  });

  it("dev, tests and e2e run the checkout's build", () => {
    expect(
      resolveMpvBinary({ override: undefined, packaged: false, bundled: () => "/b/mpv" })
    ).toBe("/b/mpv");
  });
});
