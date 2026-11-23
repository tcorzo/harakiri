// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { resolveMpvBinary } from "./mpv-binary";

describe("the mpv the app plays with", () => {
  it("HARAKIRI_MPV wins, packaged or not, and the build is never looked up", () => {
    const bundled = vi.fn<() => string>(() => "/checkout/.cache/mpv/0123456789abcdef/mpv");
    const resourcesPath = "/tmp/.mount_harakiXYZ/resources";

    expect(
      resolveMpvBinary({ override: "/opt/mpv-git/mpv", packaged: false, resourcesPath, bundled })
    ).toBe("/opt/mpv-git/mpv");
    expect(
      resolveMpvBinary({ override: "/opt/mpv-git/mpv", packaged: true, resourcesPath, bundled })
    ).toBe("/opt/mpv-git/mpv");
    expect(bundled).not.toHaveBeenCalled();
  });

  it("a packaged app plays with the mpv it ships", () => {
    const bundled = vi.fn<() => string>(() => "/never");
    expect(
      resolveMpvBinary({
        override: undefined,
        packaged: true,
        resourcesPath: "/tmp/.mount_harakiXYZ/resources",
        bundled,
      })
    ).toBe("/tmp/.mount_harakiXYZ/resources/mpv/mpv");
    expect(bundled).not.toHaveBeenCalled();
  });

  it("dev, tests and e2e run the checkout's build", () => {
    expect(
      resolveMpvBinary({
        override: undefined,
        packaged: false,
        resourcesPath: "/checkout/node_modules/electron/dist/resources",
        bundled: () => "/b/mpv",
      })
    ).toBe("/b/mpv");
  });
});
