import { ItemId } from "@harakiri/jellyfin";
import type { JsonObject, JsonValue } from "type-fest";
import { describe, expect, it } from "vitest";

import { channels } from "../shared/bridge";
import type { PlayerEvent } from "../shared/bridge";
import { ServerStatusError } from "../shared/errors";
import { createBridge } from "./bridge";
import type { BridgeIpc, IpcListener } from "./bridge";

const fakeIpc = (
  reply?: { readonly channel: string; readonly value: JsonValue },
  failure?: (channel: string) => Error
) => {
  const listeners = new Map<string, IpcListener>();
  const invoked: unknown[][] = [];

  const ipc: BridgeIpc = {
    invoke: async (channel: string, ...args: unknown[]) => {
      invoked.push([channel, ...args]);

      return failure
        ? await Promise.reject(failure(channel))
        : await Promise.resolve(reply?.channel === channel ? reply.value : undefined);
    },
    on: (channel, listener) => {
      listeners.set(channel, listener);
    },
    removeListener: (channel) => {
      listeners.delete(channel);
    },
  };

  const push = (channel: string, payload: JsonObject) =>
    listeners.get(channel)?.({ ports: [] }, payload);

  return { ipc, invoked, push };
};

const warn = (): void => {};

describe(createBridge, () => {
  it("the test surface is exposed only for e2e", () => {
    const { ipc } = fakeIpc();

    expect(Object.keys(createBridge(ipc, { e2e: false, warn })).toSorted()).toStrictEqual([
      "deviceId",
      "discover",
      "launcher",
      "player",
      "session",
      "updates",
    ]);
    expect(Object.keys(createBridge(ipc, { e2e: true, warn })).toSorted()).toStrictEqual([
      "deviceId",
      "discover",
      "launcher",
      "player",
      "session",
      "test",
      "updates",
    ]);
  });

  it("a malformed player event is dropped and logged; a valid one reaches the listener", () => {
    const { ipc, push } = fakeIpc();
    const warnings: string[] = [];
    const received: PlayerEvent[] = [];

    const bridge = createBridge(ipc, {
      e2e: false,
      warn: (message) => {
        warnings.push(message);
      },
    });

    bridge.player.onEvent((event) => {
      received.push(event);
    });

    const playing = { facts: [], downgrades: [], transcodeReasons: [], unreadable: false };
    push(channels.playerEvent, { ...playing, phase: "warp", itemId: "x", positionTicks: -1 });
    // Main always states the server's decision; an event without it is a regression, not a default.
    push(channels.playerEvent, { phase: "playing", itemId: "x", positionTicks: 10 });
    push(channels.playerEvent, { ...playing, phase: "playing", itemId: "x", positionTicks: 10 });

    expect(warnings).toStrictEqual([
      "Dropped a malformed player event",
      "Dropped a malformed player event",
    ]);
    expect(received).toStrictEqual([
      {
        phase: "playing",
        itemId: "x",
        positionTicks: 10,
        facts: [],
        downgrades: [],
        transcodeReasons: [],
        unreadable: false,
      },
    ]);
  });

  it("a main-process error crosses unwrapped, and a server status keeps its status", async () => {
    const { ipc } = fakeIpc(
      undefined,
      (channel) =>
        new Error(
          `Error invoking remote method '${channel}': ServerStatusError: The server answered 401 for /Items/x/PlaybackInfo`
        )
    );

    const bridge = createBridge(ipc, { e2e: false, warn });

    const prepare = async () =>
      await bridge.player.prepare({ itemId: ItemId.parse("0123456789abcdef0123456789abcdef") });

    await expect(prepare()).rejects.toBeInstanceOf(ServerStatusError);
    await expect(prepare()).rejects.toMatchObject({ status: 401 });
  });

  it("prepare sends the request and parses the server's decision", async () => {
    const report = {
      facts: [
        { text: "Dolby Vision mapped to HDR10", state: "mapped" },
        { text: "TrueHD Atmos bitstream", state: "native" },
      ],
      downgrades: [],
      transcodeReasons: [],
      unreadable: false,
    };

    const { ipc, invoked } = fakeIpc({ channel: channels.prepare, value: report });
    const request = { itemId: ItemId.parse("0123456789abcdef0123456789abcdef") };

    await expect(
      createBridge(ipc, { e2e: false, warn }).player.prepare(request)
    ).resolves.toStrictEqual(report);
    expect(invoked).toStrictEqual([
      ["player:prepare", { itemId: "0123456789abcdef0123456789abcdef" }],
    ]);
  });

  it("a prepare reply with an unknown signal state is refused", async () => {
    const { ipc } = fakeIpc({
      channel: channels.prepare,
      value: { facts: [{ text: "HDR10", state: "glorious" }], transcodeReasons: [] },
    });

    const request = { itemId: ItemId.parse("0123456789abcdef0123456789abcdef") };

    await expect(createBridge(ipc, { e2e: false, warn }).player.prepare(request)).rejects.toThrow(
      /Invalid option/u
    );
  });

  it("deviceId asks main and returns its id", async () => {
    const { ipc, invoked } = fakeIpc({
      channel: channels.deviceId,
      value: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
    });

    await expect(createBridge(ipc, { e2e: false, warn }).deviceId()).resolves.toBe(
      "6f9619ff-8b86-4d01-b42d-00cf4fc964ff"
    );
    expect(invoked).toStrictEqual([["device:id"]]);
  });

  it("session.storage parses where main keeps the token and refuses anything else", async () => {
    const { ipc, invoked } = fakeIpc({ channel: channels.sessionStorage, value: "file" });

    await expect(createBridge(ipc, { e2e: false, warn }).session.storage()).resolves.toBe("file");
    expect(invoked).toStrictEqual([["session:storage"]]);

    const plain = fakeIpc({ channel: channels.sessionStorage, value: "plain" });
    await expect(createBridge(plain.ipc, { e2e: false, warn }).session.storage()).rejects.toThrow(
      /Invalid option/u
    );
  });

  it("parses the update status and restart invokes its channel", async () => {
    const { ipc, invoked } = fakeIpc({
      channel: channels.updateStatus,
      value: { state: "ready", version: "0.3.0" },
    });

    const bridge = createBridge(ipc, { e2e: false, warn });

    await expect(bridge.updates.status()).resolves.toStrictEqual({
      state: "ready",
      version: "0.3.0",
    });
    await bridge.updates.restart();
    expect(invoked).toContainEqual([channels.updateRestart]);

    const bad = fakeIpc({ channel: channels.updateStatus, value: { state: "ready" } });
    await expect(createBridge(bad.ipc, { e2e: false, warn }).updates.status()).rejects.toThrow(
      /version/u
    );
  });

  it("parses the launcher status and add result, and rejects a status without a name", async () => {
    const offered = {
      state: "offered",
      name: "Steam",
      launchHint: "Launch it from there in Game Mode.",
      retryHint: "Open Steam, then try again.",
    };

    const status = fakeIpc({ channel: channels.launcherStatus, value: offered });

    await expect(
      createBridge(status.ipc, { e2e: false, warn }).launcher.status()
    ).resolves.toStrictEqual(offered);

    const bad = fakeIpc({ channel: channels.launcherStatus, value: { state: "offered" } });
    await expect(createBridge(bad.ipc, { e2e: false, warn }).launcher.status()).rejects.toThrow(
      /name/u
    );

    const add = fakeIpc({
      channel: channels.launcherAdd,
      value: { state: "failed", reason: "x" },
    });

    await expect(createBridge(add.ipc, { e2e: false, warn }).launcher.add()).resolves.toStrictEqual(
      { state: "failed", reason: "x" }
    );
    expect(add.invoked).toContainEqual([channels.launcherAdd]);
  });

  it("rejects an offered launcher status without the host's hints", async () => {
    const bad = fakeIpc({
      channel: channels.launcherStatus,
      value: { state: "offered", name: "Steam", launchHint: "Launch it from there." },
    });

    await expect(createBridge(bad.ipc, { e2e: false, warn }).launcher.status()).rejects.toThrow(
      /retryHint/u
    );
  });
});
