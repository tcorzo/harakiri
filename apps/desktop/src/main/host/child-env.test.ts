import { describe, expect, it } from "vitest";

import { bundledMpvEnv, hostToolEnv, mpvChildEnv } from "./child-env";

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

describe(hostToolEnv, () => {
  it("drops the loader's library path and preload, and keeps what pactl needs to reach the server", () => {
    expect(
      hostToolEnv({
        LD_LIBRARY_PATH: "/tmp/.mount_harakiri/usr/lib:/steam-runtime/lib",
        LD_PRELOAD: "/steam/gameoverlayrenderer.so",
        PATH: "/usr/bin",
        XDG_RUNTIME_DIR: "/run/user/1000",
        PULSE_SERVER: undefined,
      })
    ).toStrictEqual({ PATH: "/usr/bin", XDG_RUNTIME_DIR: "/run/user/1000" });
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
