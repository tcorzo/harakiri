import { describe, expect, it } from "vitest";

import { bundledMpvEnv, mpvChildEnv } from "./child-env";

describe(bundledMpvEnv, () => {
  it("drops the loader's library path and preload, and keeps the rest", () => {
    expect(
      bundledMpvEnv({
        LD_LIBRARY_PATH: "/x",
        LD_PRELOAD: "/y.so",
        HOME: "/h",
        WAYLAND_DISPLAY: "wayland-1",
      })
    ).toStrictEqual({ HOME: "/h", WAYLAND_DISPLAY: "wayland-1" });
  });

  it("drops undefined values", () => {
    expect(bundledMpvEnv({ HOME: "/h", DISPLAY: undefined })).toStrictEqual({ HOME: "/h" });
  });
});

describe(mpvChildEnv, () => {
  const env = { LD_LIBRARY_PATH: "/x", HOME: "/h", DISPLAY: undefined };

  it("passes the whole environment to a developer's own mpv", () => {
    expect(mpvChildEnv("/opt/mpv-git/mpv", env)).toStrictEqual({
      LD_LIBRARY_PATH: "/x",
      HOME: "/h",
    });
  });

  it("scrubs the environment for harakiri's build", () => {
    expect(mpvChildEnv(undefined, env)).toStrictEqual({ HOME: "/h" });
  });
});
