// @vitest-environment node
import { ItemId } from "@harakiri/jellyfin";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  start: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  token: "token",
  fidelity: {
    picture: null,
    sound: null,
    delivery: { kind: "direct" },
    soundWorld: {
      output: { kind: "unknown", detail: "test" },
      bitstreamFailed: false,
      silent: false,
    },
    pictureWorld: { renderer: "vulkan", display: "unknown" },
  },
}));

vi.mock("electron", () => ({ app: { getPath: () => "/tmp/harakiri-index-test" } }));
vi.mock("../session", () => ({
  loadSession: () => ({
    serverUrl: "http://jf.test",
    serverId: "s",
    serverName: "Test",
    serverVersion: "10.11.0",
    userId: "fedcba9876543210fedcba9876543210",
    userName: "tester",
    accessToken: mocks.token,
    deviceId: "device-1",
  }),
}));
vi.mock("./playback", () => ({
  preparePlayback: mocks.prepare,
  startPlayback: mocks.start,
  startingFidelity: () => mocks.fidelity,
  signalReport: (resolution: { facts: unknown[] }) => ({
    facts: resolution.facts,
    transcodeReasons: [],
    unreadable: false,
  }),
}));
vi.mock("./audio-output", () => ({
  AudioOutputJson: { parse: (value: unknown) => value },
  readAudioOutput: async () => ({ kind: "unknown", detail: "test" }),
}));

const { forgetPrepared, play, prepare } = await import("./index");

const itemId = ItemId.parse("0123456789abcdef0123456789abcdef");
const facts = [
  { text: "HDR10", state: "native" },
  { text: "DTS-HD MA bitstream", state: "native" },
];
const prepared = { resolution: { facts }, marker: "the handoff's resolution" };
const idle = { done: new Promise(() => {}), stop: async () => {}, probe: async () => ({}) };

beforeEach(() => {
  vi.useRealTimers();
  mocks.token = "token";
  forgetPrepared();
  mocks.prepare.mockReset().mockResolvedValue(prepared);
  mocks.start.mockReset().mockResolvedValue(idle);
});

const preparedFor = () => mocks.start.mock.calls.map((call) => call[3]);

test("play reuses the resolution the handoff prepared instead of asking the server again", async () => {
  const request = { itemId, startPositionTicks: 600_000_000, audioStreamIndex: 2 };

  await expect(prepare(request)).resolves.toEqual({
    facts,
    transcodeReasons: [],
    unreadable: false,
  });
  await play(request, () => {});

  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  expect(mocks.start.mock.calls[0]?.[3]).toBe(prepared);
});

test("both the player and the renderer identify as one client with the main device id", async () => {
  await prepare({ itemId });

  expect(mocks.prepare.mock.calls[0]?.[1]).toMatchObject({
    identity: { client: "harakiri", device: "harakiri desktop", version: "0.1.0" },
  });
});

test("a play for a different request resolves afresh, and a prepared one is used only once", async () => {
  await prepare({ itemId, startPositionTicks: 0 });
  await play({ itemId, startPositionTicks: 10 }, () => {});
  expect(mocks.start.mock.calls[0]?.[3]).toBeUndefined();

  await prepare({ itemId });
  await play({ itemId }, () => {});
  await play({ itemId }, () => {});
  expect(mocks.start.mock.calls.map((call) => call[3])).toEqual([undefined, prepared, undefined]);
});

test("a resolution older than 60 s is not reused", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  await prepare({ itemId });
  vi.advanceTimersByTime(60_001);
  await play({ itemId }, () => {});
  expect(preparedFor()).toEqual([undefined]);
});

test("a failed prepare leaves play to resolve the request itself", async () => {
  mocks.prepare.mockRejectedValueOnce(
    new Error("The server answered 500 for /Items/x/PlaybackInfo")
  );
  await expect(prepare({ itemId })).rejects.toThrow("500");
  await play({ itemId }, () => {});
  expect(preparedFor()).toEqual([undefined]);
});

test("signing out or into another account drops the resolution and the token it holds", async () => {
  await prepare({ itemId });
  forgetPrepared();
  await play({ itemId }, () => {});

  await prepare({ itemId });
  mocks.token = "another-token";
  await play({ itemId }, () => {});

  expect(preparedFor()).toEqual([undefined, undefined]);
});

test("a play for another request leaves a newer prepare in place for its own play", async () => {
  await prepare({ itemId, startPositionTicks: 0 });
  await prepare({ itemId, startPositionTicks: 10 });
  await play({ itemId, startPositionTicks: 0 }, () => {});
  await play({ itemId, startPositionTicks: 10 }, () => {});
  expect(preparedFor()).toEqual([undefined, prepared]);
});
