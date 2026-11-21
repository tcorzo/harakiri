import { configure, reset as resetLogging } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { describe, expect, it } from "vitest";

import * as capabilities from "./capabilities";
import * as facts from "./facts";
import { gamescopeSession, plasmaWayland, secrets } from "./fixtures/environments";
import { createHost } from "./host";

/** A secret store whose probe fails, as a locked or broken KWallet or Secret Service can. */
const failingSecrets: facts.SecretProbe = {
  getSelectedStorageBackend: () => "kwallet6",
  isAsyncEncryptionAvailable: async () => await Promise.reject(new Error("D-Bus timed out")),
};

/** A secret store that must not be asked at all. */
const untouchableSecrets: facts.SecretProbe = {
  getSelectedStorageBackend: () => {
    throw new Error("the secret store was probed");
  },
  isAsyncEncryptionAvailable: async () =>
    await Promise.reject(new Error("the secret store was probed")),
};

/** Captures what `harakiri` logs while `run` runs. */
const recording = async (run: () => Promise<void>): Promise<LogRecord[]> => {
  const records: LogRecord[] = [];
  await configure({
    reset: true,
    sinks: {
      memory: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ["harakiri"], lowestLevel: "debug", sinks: ["memory"] },
      { category: ["logtape", "meta"], sinks: [] },
    ],
  });

  try {
    await run();
  } finally {
    await resetLogging();
  }

  return records;
};

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

describe("a secret store probe that fails", () => {
  it("reads as no keyring, so the session goes to the file", async () => {
    const read = await facts.readHostFacts(plasmaWayland, failingSecrets);

    expect(read).toMatchObject({ secretBackend: "unknown", encryptionAvailable: false });
    expect(capabilities.capabilitiesOf(read).secretStore).toBe("file");
  });

  it("reads as no keyring when naming the backend throws too", async () => {
    const read = await facts.readHostFacts(plasmaWayland, untouchableSecrets);

    expect(read).toMatchObject({ secretBackend: "unknown", encryptionAvailable: false });
  });

  it("is logged once at warn, however often the host is asked", async () => {
    const host = createHost(plasmaWayland, failingSecrets);

    const records = await recording(async () => {
      await host.facts();
      await host.capabilities();
      await host.facts();
    });

    expect(records.map(({ level, category }) => ({ level, category }))).toStrictEqual([
      { level: "warning", category: ["harakiri", "host"] },
    ]);
  });
});

describe("the host's HDR signalling", () => {
  it("comes from the environment alone, without asking the secret store", () => {
    expect(createHost(gamescopeSession, untouchableSecrets).signalling()).toBe("swapchain-formats");
    expect(createHost(plasmaWayland, untouchableSecrets).signalling()).toBe("colour-management");
  });

  it("agrees with the capabilities", async () => {
    const host = createHost(gamescopeSession, secrets("kwallet6", true));

    await expect(host.capabilities()).resolves.toStrictEqual({
      secretStore: "keyring",
      hdrSignalling: host.signalling(),
    });
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
