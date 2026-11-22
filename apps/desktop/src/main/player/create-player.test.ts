// @vitest-environment node
import { ItemId, ServerUrl } from "@harakiri/jellyfin";
import { createClient } from "@harakiri/jellyfin/generated/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Session } from "../../shared/bridge";
import type { PlayerEvent } from "../../shared/bridge";
import { createPlayer } from "./create-player";
import type { PlayerWiring } from "./create-player";
import { playbackInfo } from "./fixtures/load";
import type { Playback, Prepared } from "./playback";
import { resolve } from "./resolve";

const itemId = ItemId.parse("0123456789abcdef0123456789abcdef");
const server = ServerUrl.parse("http://jf.test");

const session = (accessToken: string): Session =>
  Session.parse({
    serverUrl: server,
    serverId: "s",
    serverName: "Test",
    serverVersion: "10.11.0",
    userId: "fedcba9876543210fedcba9876543210",
    userName: "tester",
    accessToken,
    deviceId: "device-1",
  });

const prepared: Prepared = {
  client: createClient({ baseUrl: server }),
  auth: "test",
  resolution: resolve(playbackInfo("sdr-aac"), { itemId }, server),
  entry: Promise.resolve({ title: "Test", programme: "" }),
};

const idle: Playback = {
  done: Promise.withResolvers<undefined>().promise,
  stop: vi.fn<Playback["stop"]>().mockResolvedValue(),
  probe: vi.fn<Playback["probe"]>().mockResolvedValue({ running: true }),
  pid: vi.fn<Playback["pid"]>(),
};

let token = "token";
const preparePlayback = vi.fn<PlayerWiring["preparePlayback"]>();
const startPlayback = vi.fn<PlayerWiring["startPlayback"]>();
const send = vi.fn<(event: PlayerEvent) => void>();

const wiring: PlayerWiring = {
  loadSession: async () => await Promise.resolve(session(token)),
  userData: () => "/tmp/harakiri-create-player-test",
  extraArgs: () => [],
  audioOutput: vi.fn<PlayerWiring["audioOutput"]>().mockResolvedValue({
    kind: "unknown",
    detail: "test",
  }),
  hdrSignalling: async () => await Promise.resolve("colour-management" as const),
  mpvBinary: () => "/b/mpv",
  preparePlayback,
  startPlayback,
};

const { forgetPrepared, play, prepare } = createPlayer(wiring);

const preparedFor = () => startPlayback.mock.calls.map((call) => call[3]);

describe("the player", () => {
  beforeEach(() => {
    vi.useRealTimers();
    token = "token";
    forgetPrepared();
    preparePlayback.mockReset().mockResolvedValue(prepared);
    startPlayback.mockReset().mockResolvedValue(idle);
  });

  it("is playing from play until mpv exits, so the updater never installs under a film", async () => {
    const exited = Promise.withResolvers<undefined>();

    const player = createPlayer({
      ...wiring,
      startPlayback: vi.fn<PlayerWiring["startPlayback"]>().mockResolvedValue({
        ...idle,
        done: exited.promise,
      }),
    });

    expect(player.isPlaying()).toBe(false);
    await player.play({ itemId }, send);
    expect(player.isPlaying()).toBe(true);
    exited.resolve(undefined);
    await exited.promise;
    expect(player.isPlaying()).toBe(false);
  });

  it("play reuses the resolution the handoff prepared instead of asking the server again", async () => {
    const request = { itemId, startPositionTicks: 600_000_000, audioStreamIndex: 2 };

    await expect(prepare(request)).resolves.toStrictEqual({
      facts: [
        { text: "SDR", state: "native" },
        { text: "AAC decoded to PCM", state: "decoded" },
      ],
      downgrades: [],
      transcodeReasons: [],
      unreadable: false,
    });
    await play(request, send);

    expect(preparePlayback).toHaveBeenCalledOnce();
    expect(startPlayback.mock.calls[0]?.[3]).toBe(prepared);
  });

  it("play hands the compositor's HDR signalling to the playback it starts", async () => {
    const player = createPlayer({
      ...wiring,
      hdrSignalling: async () => await Promise.resolve("swapchain-formats" as const),
    });

    await player.play({ itemId }, send);

    expect(startPlayback.mock.calls[0]?.[2]).toMatchObject({ hdrSignalling: "swapchain-formats" });
  });

  it("play hands the wiring's mpv binary to the playback it starts", async () => {
    await play({ itemId }, send);

    expect(startPlayback.mock.calls[0]?.[2]).toMatchObject({ mpvBinary: "/b/mpv" });
  });

  it("a missing mpv build fails the play that needs it, not the handoff before it", async () => {
    const missing =
      "harakiri's mpv build 0123456789abcdef is missing (/b): run `mise run mpv:build`";

    const player = createPlayer({
      ...wiring,
      mpvBinary: () => {
        throw new Error(missing);
      },
    });

    await expect(player.prepare({ itemId })).resolves.toMatchObject({ unreadable: false });
    await expect(player.play({ itemId }, send)).rejects.toThrow(missing);
    expect(startPlayback).not.toHaveBeenCalled();
  });

  it("a missing mpv build leaves the film already playing alone", async () => {
    const missing =
      "harakiri's mpv build 0123456789abcdef is missing (/b): run `mise run mpv:build`";

    const playing: Playback = { ...idle, stop: vi.fn<Playback["stop"]>().mockResolvedValue() };
    const binary = vi.fn<PlayerWiring["mpvBinary"]>().mockReturnValueOnce("/b/mpv");
    startPlayback.mockResolvedValueOnce(playing);

    const player = createPlayer({ ...wiring, mpvBinary: binary });
    await player.play({ itemId }, send);
    binary.mockImplementation(() => {
      throw new Error(missing);
    });

    await expect(player.play({ itemId }, send)).rejects.toThrow(missing);
    expect(playing.stop).not.toHaveBeenCalled();
    expect(player.isPlaying()).toBe(true);
    expect(startPlayback).toHaveBeenCalledOnce();
  });

  it("both the player and the renderer identify as one client with the main device id", async () => {
    await prepare({ itemId });

    expect(preparePlayback.mock.calls[0]?.[1]).toMatchObject({
      identity: { client: "harakiri", device: "harakiri desktop", version: "0.1.0" },
    });
  });

  it("a play for a different request resolves afresh, and a prepared one is used only once", async () => {
    await prepare({ itemId, startPositionTicks: 0 });
    await play({ itemId, startPositionTicks: 10 }, send);
    expect(startPlayback.mock.calls[0]?.[3]).toBeUndefined();

    await prepare({ itemId });
    await play({ itemId }, send);
    await play({ itemId }, send);
    expect(preparedFor()).toStrictEqual([undefined, prepared, undefined]);
  });

  it("a resolution older than 60 s is not reused", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await prepare({ itemId });
    vi.advanceTimersByTime(60_001);
    await play({ itemId }, send);
    expect(preparedFor()).toStrictEqual([undefined]);
  });

  it("a failed prepare leaves play to resolve the request itself", async () => {
    preparePlayback.mockRejectedValueOnce(
      new Error("The server answered 500 for /Items/x/PlaybackInfo")
    );
    await expect(prepare({ itemId })).rejects.toThrow("500");
    await play({ itemId }, send);
    expect(preparedFor()).toStrictEqual([undefined]);
  });

  it("signing out or into another account drops the resolution and the token it holds", async () => {
    await prepare({ itemId });
    forgetPrepared();
    await play({ itemId }, send);

    await prepare({ itemId });
    token = "another-token";
    await play({ itemId }, send);

    expect(preparedFor()).toStrictEqual([undefined, undefined]);
  });

  it("a sign-out while prepare still loads the session keeps nothing from the old session", async () => {
    const loaded = Promise.withResolvers<Session>();
    const player = createPlayer({ ...wiring, loadSession: async () => await loaded.promise });
    const preparing = player.prepare({ itemId });
    player.forgetPrepared();
    loaded.resolve(session("old-token"));

    await expect(preparing).rejects.toThrow("The session changed while preparing");
    expect(preparePlayback).not.toHaveBeenCalled();

    await player.play({ itemId }, send);
    expect(preparedFor()).toStrictEqual([undefined]);
  });

  it("a play for another request leaves a newer prepare in place for its own play", async () => {
    await prepare({ itemId, startPositionTicks: 0 });
    await prepare({ itemId, startPositionTicks: 10 });
    await play({ itemId, startPositionTicks: 0 }, send);
    await play({ itemId, startPositionTicks: 10 }, send);
    expect(preparedFor()).toStrictEqual([undefined, prepared]);
  });
});
