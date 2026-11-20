import { describe, expect, it } from "vitest";

import { buildPlaybackArgs, configArg } from "./args";

describe(buildPlaybackArgs, () => {
  it("defaults to fullscreen gpu-next on Vulkan and bitstreams the PRD codec list", () => {
    expect(buildPlaybackArgs()).toStrictEqual([
      "--vo=gpu-next",
      "--gpu-api=vulkan",
      "--target-colorspace-hint=auto",
      "--hwdec=auto-safe",
      "--fullscreen=yes",
      "--input-gamepad=yes",
      "--ytdl=no",
      "--audio-spdif=ac3,eac3,dts-hd,truehd",
    ]);
  });

  it("maps every config field to its mpv option", () => {
    expect(
      buildPlaybackArgs({
        colorspaceHint: "no",
        hwdec: "vaapi",
        audioPassthrough: ["eac3", "truehd", "eac3", "dts-hd"],
        audioDevice: "pipewire/alsa_output.hdmi-stereo",
        fullscreen: false,
        gamepad: false,
      })
    ).toStrictEqual([
      "--vo=gpu-next",
      "--gpu-api=vulkan",
      "--target-colorspace-hint=no",
      "--hwdec=vaapi",
      "--fullscreen=no",
      "--input-gamepad=no",
      "--ytdl=no",
      "--audio-spdif=eac3,truehd,dts-hd",
      "--audio-device=pipewire/alsa_output.hdmi-stereo",
    ]);
  });

  it("passthrough off is the explicit `none`, which leaves --audio-spdif out", () => {
    expect(buildPlaybackArgs({ audioPassthrough: "none" })).not.toContainEqual(
      expect.stringMatching(/^--audio-spdif/u)
    );
    expect(buildPlaybackArgs({ audioPassthrough: ["ac3"] })).toContain("--audio-spdif=ac3");
  });
});

describe(configArg, () => {
  it("configArg points mpv at an app-owned dir, or at nothing", () => {
    expect(configArg({ dir: "/data/u/.config/harakiri/mpv" })).toBe(
      "--config-dir=/data/u/.config/harakiri/mpv"
    );
    expect(configArg("none")).toBe("--no-config");
  });
});
