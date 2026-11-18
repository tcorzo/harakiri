// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ownAppImage, startUpdates } from "./updates";
import type { UpdateDeps, UpdaterLike } from "./updates";

function fakeUpdater() {
  const on: {
    available?: (v: string) => void;
    notAvailable?: () => void;
    progress?: (p: number) => void;
    downloaded?: (v: string) => void;
    error?: (e: Error) => void;
  } = {};

  const calls = { check: 0, download: 0, cancel: 0, installs: [] as boolean[] };
  let checkResult: () => Promise<unknown> = async () => await Promise.resolve();
  let downloadResult: () => Promise<unknown> = async () => await Promise.resolve();
  let installResult: () => boolean = () => true;
  let cancelHook: () => void = () => {};

  const updater: UpdaterLike = {
    check: async () => {
      calls.check += 1;

      return await checkResult();
    },
    download: async () => {
      calls.download += 1;

      return await downloadResult();
    },
    cancelDownload: () => {
      calls.cancel += 1;
      cancelHook();
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
      checkResult = async () => await Promise.reject(e);
    },
    failDownloads: (e: Error) => {
      downloadResult = async () => await Promise.reject(e);
    },
    /** Downloads hang until cancelled, then reject the way electron-updater's CancellationError does. */
    hangDownloadsUntilCancelled: () => {
      downloadResult = async () =>
        await new Promise((_resolve, reject) => {
          cancelHook = () => {
            reject(new Error("cancelled"));
          };
        });
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
    quit: () => {},
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
    quit: () => {},
  });

  expect(updates.status()).toEqual({ state: "unsupported" });
  expect(() => {
    updates.installIfReady();
  }).not.toThrow();
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

test("a failed check is reported and retried 15 minutes after it started", async () => {
  const fake = fakeUpdater();
  fake.failChecks(new Error("net::ERR_INTERNET_DISCONNECTED"));
  const updates = start(fake);
  await vi.advanceTimersByTimeAsync(0);
  fake.on.error?.(new Error("net::ERR_INTERNET_DISCONNECTED"));
  expect(updates.status()).toEqual({
    state: "failed",
    message: "net::ERR_INTERNET_DISCONNECTED",
  });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fake.calls.check).toBe(1);
  await vi.advanceTimersByTimeAsync(780_000); // +14 min
  expect(fake.calls.check).toBe(1);
  await vi.advanceTimersByTimeAsync(60_000); // +15 min
  expect(fake.calls.check).toBe(2);
  fake.on.notAvailable?.();
  expect(updates.status()).toEqual({ state: "idle" });
  await vi.advanceTimersByTimeAsync(900_000);
  expect(fake.calls.check).toBe(2);
});

test("the failed-check retry delay is injectable", async () => {
  const fake = fakeUpdater();
  const updates = start(fake, { retryAfterMs: 120_000 });
  fake.on.error?.(new Error("ENOTFOUND"));
  expect(updates.status().state).toBe("failed");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fake.calls.check).toBe(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fake.calls.check).toBe(2);
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
  expect(() => {
    updates.installIfReady();
  }).not.toThrow();
  expect(updates.status()).toEqual({ state: "failed", message: "EACCES" });
});

test("a download that rejects without an error event fails and is retried", async () => {
  const fake = fakeUpdater();
  fake.failDownloads(new Error("ECONNRESET"));
  const updates = start(fake);
  fake.on.available?.("0.3.0");
  await vi.advanceTimersByTimeAsync(0);
  expect(updates.status()).toEqual({ state: "failed", message: "ECONNRESET" });
  await vi.advanceTimersByTimeAsync(900_000);
  expect(fake.calls.check).toBe(2);
});

test("a download stops when playback starts and resumes once nothing plays", async () => {
  let playing = false;
  const fake = fakeUpdater();
  fake.hangDownloadsUntilCancelled();
  const updates = start(fake, { isPlaying: () => playing });
  fake.on.available?.("0.3.0");
  fake.on.progress?.(20);
  expect(updates.status()).toEqual({ state: "downloading", version: "0.3.0", percent: 20 });

  playing = true;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fake.calls.cancel).toBe(1);
  expect(updates.status()).toEqual({ state: "available", version: "0.3.0" });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fake.calls.cancel).toBe(1);
  expect(fake.calls.download).toBe(1);
  expect(updates.status()).toEqual({ state: "available", version: "0.3.0" });

  playing = false;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fake.calls.download).toBe(2);
  expect(updates.status()).toEqual({ state: "downloading", version: "0.3.0", percent: 0 });
});

test("a download is not cancelled while nothing plays", async () => {
  const fake = fakeUpdater();
  fake.hangDownloadsUntilCancelled();
  const updates = start(fake);
  fake.on.available?.("0.3.0");
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fake.calls.cancel).toBe(0);
  expect(updates.status().state).toBe("downloading");
});

test("a throwing createUpdater reports failed and leaves the app running", () => {
  const quit = vi.fn<() => void>();
  const releaseLock = vi.fn<() => void>();

  const updates = startUpdates({
    appImage: "/apps/harakiri-x86_64.AppImage",
    createUpdater: () => {
      throw new Error("electron-updater did not pick an installing updater on this platform");
    },
    isPlaying: () => false,
    releaseLock,
    quit,
  });

  expect(updates.status()).toEqual({
    state: "failed",
    message: "electron-updater did not pick an installing updater on this platform",
  });
  expect(() => {
    updates.installIfReady();
  }).not.toThrow();
  updates.restart();
  expect(quit).not.toHaveBeenCalled();
  expect(releaseLock).not.toHaveBeenCalled();
});

describe("ownAppImage", () => {
  const appImage = "/apps/harakiri-x86_64.AppImage";

  test("is the AppImage when this process runs from its mount", () => {
    expect(
      ownAppImage({
        appImage,
        appDir: "/tmp/.mount_harakiAbC",
        execPath: "/tmp/.mount_harakiAbC/harakiri",
      })
    ).toBe(appImage);
  });

  test("ignores an APPIMAGE inherited from another AppImage's terminal", () => {
    expect(
      ownAppImage({
        appImage: "/apps/Terminal.AppImage",
        appDir: "/tmp/.mount_TerminXyZ",
        execPath: "/repo/apps/desktop/dist/linux-unpacked/harakiri",
      })
    ).toBeUndefined();
  });

  test("ignores an APPIMAGE without an APPDIR", () => {
    expect(
      ownAppImage({ appImage, appDir: undefined, execPath: "/tmp/.mount_harakiAbC/harakiri" })
    ).toBeUndefined();
  });

  test("ignores a mount that only shares a prefix with execPath", () => {
    expect(
      ownAppImage({
        appImage,
        appDir: "/tmp/.mount_harak",
        execPath: "/tmp/.mount_harakiAbC/harakiri",
      })
    ).toBeUndefined();
  });

  test("is undefined without an APPIMAGE", () => {
    expect(
      ownAppImage({
        appImage: undefined,
        appDir: "/tmp/.mount_harakiAbC",
        execPath: "/tmp/.mount_harakiAbC/harakiri",
      })
    ).toBeUndefined();
  });
});

test("restart quits only when an update is ready", () => {
  const fake = fakeUpdater();
  const quit = vi.fn<() => void>();
  const releaseLock = vi.fn<() => void>();
  const updates = start(fake, { quit, releaseLock });

  updates.restart();
  expect(quit).not.toHaveBeenCalled();

  fake.on.downloaded?.("0.3.0");
  updates.restart();
  expect(quit).toHaveBeenCalledOnce();

  updates.installIfReady();
  expect(releaseLock).toHaveBeenCalledOnce();
  expect(fake.calls.installs).toEqual([true]);
});
