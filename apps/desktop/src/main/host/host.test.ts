import { describe, expect, it } from "vitest";

import * as capabilities from "./capabilities";
import * as facts from "./facts";
import { gamescopeSession, plasmaWayland, secrets } from "./fixtures/environments";

const desktopOf = async (value: string) => {
  const read = await facts.readHostFacts({ XDG_CURRENT_DESKTOP: value }, secrets("kwallet6", true));

  return read.desktop;
};

describe("host facts", () => {
  it("reads Game Mode's facts", async () => {
    await expect(
      facts.readHostFacts(gamescopeSession, secrets("basic_text", true))
    ).resolves.toStrictEqual({
      gamescopeDisplay: "gamescope-0",
      waylandDisplay: undefined,
      desktop: ["gamescope"],
      secretBackend: "basic_text",
      encryptionAvailable: true,
    });
  });

  it("splits XDG_CURRENT_DESKTOP on colons", async () => {
    await expect(desktopOf("ubuntu:GNOME")).resolves.toStrictEqual(["ubuntu", "GNOME"]);
    await expect(desktopOf("")).resolves.toStrictEqual([]);
    await expect(desktopOf(":KDE:")).resolves.toStrictEqual(["KDE"]);
  });

  it("treats an empty display variable as unset", async () => {
    const read = await facts.readHostFacts(
      { GAMESCOPE_WAYLAND_DISPLAY: "", WAYLAND_DISPLAY: "" },
      secrets("kwallet6", true)
    );

    expect(read.gamescopeDisplay).toBeUndefined();
    expect(read.waylandDisplay).toBeUndefined();
  });
});

describe("host capabilities", () => {
  it.each([
    ["basic_text", true, "file"],
    ["unknown", true, "file"],
    ["gnome_libsecret", false, "file"],
    ["kwallet6", true, "keyring"],
    ["gnome_libsecret", true, "keyring"],
  ])("backend %s, available %s gives secretStore %s", async (backend, available, store) => {
    const read = await facts.readHostFacts(plasmaWayland, secrets(backend, available));

    expect(capabilities.capabilitiesOf(read).secretStore).toBe(store);
  });

  it.each([
    ["Game Mode", gamescopeSession, "swapchain-formats"],
    ["Plasma Wayland", plasmaWayland, "colour-management"],
    [
      "a nested Wayland client inside gamescope",
      { ...gamescopeSession, WAYLAND_DISPLAY: "wayland-1" },
      "colour-management",
    ],
    [
      "a client on gamescope's own display",
      { ...gamescopeSession, WAYLAND_DISPLAY: "gamescope-0" },
      "swapchain-formats",
    ],
  ])("%s gives hdrSignalling %s", async (_name, env, signalling) => {
    const read = await facts.readHostFacts(env, secrets("kwallet6", true));

    expect(capabilities.capabilitiesOf(read).hdrSignalling).toBe(signalling);
  });
});
