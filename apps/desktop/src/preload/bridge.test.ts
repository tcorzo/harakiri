import type { IpcRenderer, IpcRendererEvent } from "electron";
import { ItemId } from "@harakiri/jellyfin";
import { expect, test } from "vitest";
import { channels, type PlayerEvent } from "../shared/bridge";
import { ServerStatusError } from "../shared/errors";
import { createBridge } from "./bridge";

function fakeIpc(replies: Record<string, unknown> = {}, failure?: (channel: string) => Error) {
  const listeners = new Map<string, (event: IpcRendererEvent, payload: unknown) => void>();
  const invoked: unknown[][] = [];
  const ipc = {
    invoke: (channel: string, ...args: unknown[]) => {
      invoked.push([channel, ...args]);
      return failure ? Promise.reject(failure(channel)) : Promise.resolve(replies[channel]);
    },
    on: (channel: string, listener: (event: IpcRendererEvent, payload: unknown) => void) => {
      listeners.set(channel, listener);
      return ipc;
    },
    removeListener: (channel: string) => {
      listeners.delete(channel);
      return ipc;
    },
  };
  const push = (channel: string, payload: unknown) =>
    listeners.get(channel)?.({} as IpcRendererEvent, payload);
  return { ipc: ipc as unknown as IpcRenderer, invoked, push };
}

const warn = (): void => {};

test("the test surface is exposed only for e2e", () => {
  const { ipc } = fakeIpc();

  expect(Object.keys(createBridge(ipc, { e2e: false, warn })).toSorted()).toEqual([
    "deviceId",
    "discover",
    "player",
    "session",
  ]);
  expect(Object.keys(createBridge(ipc, { e2e: true, warn })).toSorted()).toEqual([
    "deviceId",
    "discover",
    "player",
    "session",
    "test",
  ]);
});

test("a malformed player event is dropped and logged; a valid one reaches the listener", () => {
  const { ipc, push } = fakeIpc();
  const warnings: string[] = [];
  const received: PlayerEvent[] = [];
  const bridge = createBridge(ipc, { e2e: false, warn: (message) => warnings.push(message) });
  bridge.player.onEvent((event) => received.push(event));

  const playing = { facts: [], downgrades: [], transcodeReasons: [], unreadable: false };
  push(channels.playerEvent, { ...playing, phase: "warp", itemId: "x", positionTicks: -1 });
  // Main always states the server's decision; an event without it is a regression, not a default.
  push(channels.playerEvent, { phase: "playing", itemId: "x", positionTicks: 10 });
  push(channels.playerEvent, { ...playing, phase: "playing", itemId: "x", positionTicks: 10 });

  expect(warnings).toEqual([
    "Dropped a malformed player event",
    "Dropped a malformed player event",
  ]);
  expect(received).toEqual([
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

test("a main-process error crosses unwrapped, and a server status keeps its status", async () => {
  const { ipc } = fakeIpc(
    {},
    (channel) =>
      new Error(
        `Error invoking remote method '${channel}': ServerStatusError: The server answered 401 for /Items/x/PlaybackInfo`,
      ),
  );
  const bridge = createBridge(ipc, { e2e: false, warn });
  const error: unknown = await bridge.player
    .prepare({ itemId: ItemId.parse("0123456789abcdef0123456789abcdef") })
    .catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ServerStatusError);
  expect(error).toMatchObject({ status: 401 });
});

test("prepare sends the request and parses the server's decision", async () => {
  const report = {
    facts: [
      { text: "Dolby Vision mapped to HDR10", state: "mapped" },
      { text: "TrueHD Atmos bitstream", state: "native" },
    ],
    downgrades: [],
    transcodeReasons: [],
    unreadable: false,
  };
  const { ipc, invoked } = fakeIpc({ [channels.prepare]: report });
  const request = { itemId: ItemId.parse("0123456789abcdef0123456789abcdef") };

  await expect(createBridge(ipc, { e2e: false, warn }).player.prepare(request)).resolves.toEqual(
    report,
  );
  expect(invoked).toEqual([["player:prepare", { itemId: "0123456789abcdef0123456789abcdef" }]]);
});

test("a prepare reply with an unknown signal state is refused", async () => {
  const { ipc } = fakeIpc({
    [channels.prepare]: { facts: [{ text: "HDR10", state: "glorious" }], transcodeReasons: [] },
  });
  const request = { itemId: ItemId.parse("0123456789abcdef0123456789abcdef") };

  await expect(createBridge(ipc, { e2e: false, warn }).player.prepare(request)).rejects.toThrow(
    /Invalid option/,
  );
});

test("deviceId asks main and returns its id", async () => {
  const { ipc, invoked } = fakeIpc({ [channels.deviceId]: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff" });

  await expect(createBridge(ipc, { e2e: false, warn }).deviceId()).resolves.toBe(
    "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
  );
  expect(invoked).toEqual([["device:id"]]);
});
