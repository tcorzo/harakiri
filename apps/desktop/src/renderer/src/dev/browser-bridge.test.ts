import { beforeEach, describe, expect, it } from "vitest";

import { NewSession, PlayRequest } from "../../../shared/bridge";
import { browserBridge } from "./browser-bridge";

const newSession = NewSession.parse({
  serverUrl: "http://jellyfin.test:8096",
  serverId: "srv-1",
  serverName: "Test Server",
  serverVersion: "12.4.0",
  userId: "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
  userName: "owner",
  accessToken: "token-123",
});

describe("the browser bridge", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps one device id across calls", async () => {
    const first = await browserBridge.deviceId();

    await expect(browserBridge.deviceId()).resolves.toBe(first);
  });

  it("returns a saved session with the stored device id", async () => {
    await browserBridge.session.save(newSession);

    const session = await browserBridge.session.get();

    expect(session?.userName).toBe("owner");
    expect(session?.accessToken).toBe("token-123");
    expect(session?.deviceId).toBe(await browserBridge.deviceId());
  });

  it("returns null after clear", async () => {
    await browserBridge.session.save(newSession);
    await browserBridge.session.clear();

    await expect(browserBridge.session.get()).resolves.toBeNull();
  });

  it("returns null for garbage in storage", async () => {
    localStorage.setItem("harakiri.dev.session", "{not json");

    await expect(browserBridge.session.get()).resolves.toBeNull();

    localStorage.setItem("harakiri.dev.session", JSON.stringify({ userName: 3 }));

    await expect(browserBridge.session.get()).resolves.toBeNull();
  });

  it("refuses to play, saying why", async () => {
    await expect(
      browserBridge.player.play(PlayRequest.parse({ itemId: "0a1b2c3d4e5f60718293a4b5c6d7e8f9" }))
    ).rejects.toThrow("Playback needs the Electron app");
  });
});
