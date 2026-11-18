// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type UpdateDeps, type UpdaterLike, startUpdates } from "./updates";

function fakeUpdater() {
  const on: {
    available?: (v: string) => void;
    notAvailable?: () => void;
    progress?: (p: number) => void;
    downloaded?: (v: string) => void;
    error?: (e: Error) => void;
  } = {};
  const calls = { check: 0, download: 0, installs: [] as boolean[] };
  let checkResult: () => Promise<unknown> = () => Promise.resolve();
  let downloadResult: () => Promise<unknown> = () => Promise.resolve();
  let installResult: () => boolean = () => true;
  const updater: UpdaterLike = {
    check: () => {
      calls.check += 1;
      return checkResult();
    },
    download: () => {
      calls.download += 1;
      return downloadResult();
    },
    install: (relaunch) => {
      calls.installs.push(relaunch);
      return installResult();
    },
    onAvailable: (l) => {
      on.available = l;
    },
    onNotAvailable: (l) => {
      on.notAvailable = l;
    },
    onProgress: (l) => {
      on.progress = l;
    },
    onDownloaded: (l) => {
      on.downloaded = l;
    },
    onError: (l) => {
      on.error = l;
    },
  };
  return {
    updater,
    on,
    calls,
    failChecks: (e: Error) => {
      checkResult = () => Promise.reject(e);
    },
    failDownloads: (e: Error) => {
      downloadResult = () => Promise.reject(e);
    },
    failInstall: () => {
      installResult = () => {
        throw new Error("EACCES");
      };
    },
  };
}

const start = (fake: ReturnType<typeof fakeUpdater>, over: Partial<UpdateDeps> = {}) =>
  startUpdates({
    appImage: "/apps/harakiri-x86_64.AppImage",
    createUpdater: () => fake.updater,
    isPlaying: () => false,
    releaseLock: () => {},
    ...over,
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("unsupported without an AppImage, and electron-updater is never created", () => {
  const updates = startUpdates({
    appImage: undefined,
    createUpdater: () => {
      throw new Error("created");
    },
    isPlaying: () => false,
    releaseLock: () => {},
  });
  expect(updates.status()).toEqual({ state: "unsupported" });
  expect(() => updates.installIfReady()).not.toThrow();
});

test("checks at start and every 6 hours", () => {
  const fake = fakeUpdater();
  start(fake);
  expect(fake.calls.check).toBe(1);
  vi.advanceTimersByTime(21_600_000);
  expect(fake.calls.check).toBe(2);
});

test("walks available → downloading → ready", () => {
  const fake = fakeUpdater();
  const updates = start(fake);
  fake.on.available?.("0.3.0");
  expect(fake.calls.download).toBe(1);
  expect(updates.status()).toEqual({ state: "downloading", version: "0.3.0", percent: 0 });
  fake.on.progress?.(41.6);
  expect(updates.status()).toEqual({ state: "downloading", version: "0.3.0", percent: 41.6 });
  fake.on.downloaded?.("0.3.0");
  expect(updates.status()).toEqual({ state: "ready", version: "0.3.0" });
});

test("downloads only once nothing plays", () => {
  let playing = true;
  const fake = fakeUpdater();
  const updates = start(fake, { isPlaying: () => playing });
  fake.on.available?.("0.3.0");
  expect(fake.calls.download).toBe(0);
  expect(updates.status()).toEqual({ state: "available", version: "0.3.0" });
  vi.advanceTimersByTime(60_000);
  expect(fake.calls.download).toBe(0);
  playing = false;
  vi.advanceTimersByTime(60_000);
  expect(fake.calls.download).toBe(1);
});

test("does not check again while downloading or ready", () => {
  const fake = fakeUpdater();
  start(fake);
  fake.on.available?.("0.3.0");
  fake.on.downloaded?.("0.3.0");
  vi.advanceTimersByTime(21_600_000);
  expect(fake.calls.check).toBe(1);
});

test("a failed check is reported and retried on the next interval", async () => {
  const fake = fakeUpdater();
  fake.failChecks(new Error("net::ERR_INTERNET_DISCONNECTED"));
  const updates = start(fake);
  await vi.advanceTimersByTimeAsync(0);
  fake.on.error?.(new Error("net::ERR_INTERNET_DISCONNECTED"));
  expect(updates.status()).toEqual({
    state: "failed",
    message: "net::ERR_INTERNET_DISCONNECTED",
  });
  await vi.advanceTimersByTimeAsync(21_600_000);
  expect(fake.calls.check).toBe(2);
  fake.on.notAvailable?.();
  expect(updates.status()).toEqual({ state: "idle" });
});

test("installIfReady does nothing unless an update is downloaded", () => {
  let playing = true;
  const fake = fakeUpdater();
  const updates = start(fake, { isPlaying: () => playing });
  fake.on.available?.("0.3.0");
  updates.installIfReady();
  playing = false;
  vi.advanceTimersByTime(60_000);
  expect(updates.status().state).toBe("downloading");
  updates.installIfReady();
  expect(fake.calls.installs).toEqual([]);
});

test("installIfReady installs silently without relaunch", () => {
  const releaseLock = vi.fn<() => void>();
  const fake = fakeUpdater();
  const updates = start(fake, { releaseLock });
  fake.on.downloaded?.("0.3.0");
  updates.installIfReady();
  expect(fake.calls.installs).toEqual([false]);
  expect(releaseLock).not.toHaveBeenCalled();
});

test("an install that throws marks the update failed", () => {
  const fake = fakeUpdater();
  fake.failInstall();
  const updates = start(fake);
  fake.on.downloaded?.("0.3.0");
  expect(() => updates.installIfReady()).not.toThrow();
  expect(updates.status()).toEqual({ state: "failed", message: "EACCES" });
});

test("a download that rejects without an error event fails and is retried", async () => {
  const fake = fakeUpdater();
  fake.failDownloads(new Error("ECONNRESET"));
  const updates = start(fake);
  fake.on.available?.("0.3.0");
  await vi.advanceTimersByTimeAsync(0);
  expect(updates.status()).toEqual({ state: "failed", message: "ECONNRESET" });
  await vi.advanceTimersByTimeAsync(21_600_000);
  expect(fake.calls.check).toBe(2);
});
