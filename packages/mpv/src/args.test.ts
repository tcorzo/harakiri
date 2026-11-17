import { describe, expect, test } from "vitest";
import { buildPlaybackArgs, configArg } from "./args";

describe("buildPlaybackArgs", () => {
  test("defaults to fullscreen gpu-next on Vulkan and bitstreams the PRD codec list", () => {
    expect(buildPlaybackArgs()).toEqual([
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

  test("maps every config field to its mpv option", () => {
    expect(
      buildPlaybackArgs({
        colorspaceHint: "no",
        hwdec: "vaapi",
        audioPassthrough: ["eac3", "truehd", "eac3", "dts-hd"],
        audioDevice: "pipewire/alsa_output.hdmi-stereo",
        fullscreen: false,
        gamepad: false,
      }),
    ).toEqual([
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

  test("passthrough off is the explicit `none`, which leaves --audio-spdif out", () => {
    expect(buildPlaybackArgs({ audioPassthrough: "none" })).not.toContainEqual(
      expect.stringMatching(/^--audio-spdif/),
    );
    expect(buildPlaybackArgs({ audioPassthrough: ["ac3"] })).toContain("--audio-spdif=ac3");
  });
});

test("configArg points mpv at an app-owned dir, or at nothing", () => {
  expect(configArg({ dir: "/data/u/.config/harakiri/mpv" })).toBe(
    "--config-dir=/data/u/.config/harakiri/mpv",
  );
  expect(configArg("none")).toBe("--no-config");
});
