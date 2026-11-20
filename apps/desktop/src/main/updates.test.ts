// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ownAppImage, startUpdates } from "./updates";
import type { UpdateDeps, UpdaterLike } from "./updates";

interface Handlers {
  available?: (v: string) => void;
  notAvailable?: () => void;
  progress?: (p: number) => void;
  downloaded?: (v: string) => void;
  error?: (e: Error) => void;
}

const resolved = async (): Promise<void> => {
  await Promise.resolve();
};

const accepted = (): boolean => true;
const noop = (): void => {};

const fakeUpdater = () => {
  const on: Handlers = {};
  const calls = { check: 0, download: 0, cancel: 0, installs: new Array<boolean>() };
  let checkResult: () => Promise<void> = resolved;
  let downloadResult: () => Promise<void> = resolved;
  let installResult: () => boolean = accepted;
  let cancelHook: () => void = noop;

  const updater: UpdaterLike = {
    check: async () => {
      calls.check += 1;
      await checkResult();
    },
    download: async () => {
      calls.download += 1;
      await downloadResult();
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
      checkResult = async () => {
        await Promise.reject(e);
      };
    },
    failDownloads: (e: Error) => {
      downloadResult = async () => {
        await Promise.reject(e);
      };
    },
    /** Downloads hang until cancelled, then reject the way electron-updater's CancellationError does. */
    hangDownloadsUntilCancelled: () => {
      downloadResult = async () => {
        const hung = Promise.withResolvers<undefined>();
        cancelHook = () => {
          hung.reject(new Error("cancelled"));
        };

        await hung.promise;
      };
    },
    failInstall: () => {
      installResult = () => {
        throw new Error("EACCES");
      };
    },
  };
};

const start = (fake: ReturnType<typeof fakeUpdater>, over: Partial<UpdateDeps> = {}) =>
  startUpdates({
    appImage: "/apps/harakiri-x86_64.AppImage",
    createUpdater: () => fake.updater,
    isPlaying: () => false,
    releaseLock: noop,
    quit: noop,
    ...over,
  });

describe(startUpdates, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is unsupported without an AppImage, and electron-updater is never created", () => {
    const updates = startUpdates({
      appImage: undefined,
      createUpdater: () => {
        throw new Error("created");
      },
      isPlaying: () => false,
      releaseLock: noop,
      quit: noop,
    });

    expect(updates.status()).toStrictEqual({ state: "unsupported" });
    expect(() => {
      updates.installIfReady();
    }).not.toThrow();
  });

  it("checks at start and every 6 hours", () => {
    const fake = fakeUpdater();
    start(fake);
    expect(fake.calls.check).toBe(1);
    vi.advanceTimersByTime(21_600_000);
    expect(fake.calls.check).toBe(2);
  });

  it("walks available → downloading → ready", () => {
    const fake = fakeUpdater();
    const updates = start(fake);
    fake.on.available?.("0.3.0");
    expect(fake.calls.download).toBe(1);
    expect(updates.status()).toStrictEqual({ state: "downloading", version: "0.3.0", percent: 0 });
    fake.on.progress?.(41.6);
    expect(updates.status()).toStrictEqual({
      state: "downloading",
      version: "0.3.0",
      percent: 41.6,
    });
    fake.on.downloaded?.("0.3.0");
    expect(updates.status()).toStrictEqual({ state: "ready", version: "0.3.0" });
  });

  it("downloads only once nothing plays", () => {
    let playing = true;
    const fake = fakeUpdater();
    const updates = start(fake, { isPlaying: () => playing });
    fake.on.available?.("0.3.0");
    expect(fake.calls.download).toBe(0);
    expect(updates.status()).toStrictEqual({ state: "available", version: "0.3.0" });
    vi.advanceTimersByTime(60_000);
    expect(fake.calls.download).toBe(0);
    playing = false;
    vi.advanceTimersByTime(60_000);
    expect(fake.calls.download).toBe(1);
  });

  it("does not check again while downloading or ready", () => {
    const fake = fakeUpdater();
    start(fake);
    fake.on.available?.("0.3.0");
    fake.on.downloaded?.("0.3.0");
    vi.advanceTimersByTime(21_600_000);
    expect(fake.calls.check).toBe(1);
  });

  it("reports a failed check", async () => {
    const fake = fakeUpdater();
    fake.failChecks(new Error("net::ERR_INTERNET_DISCONNECTED"));
    const updates = start(fake);
    await vi.advanceTimersByTimeAsync(0);
    fake.on.error?.(new Error("net::ERR_INTERNET_DISCONNECTED"));
    expect(updates.status()).toStrictEqual({
      state: "failed",
      message: "net::ERR_INTERNET_DISCONNECTED",
    });
  });

  it("retries a failed check 15 minutes after it started", async () => {
    const fake = fakeUpdater();
    fake.failChecks(new Error("net::ERR_INTERNET_DISCONNECTED"));
    const updates = start(fake);
    await vi.advanceTimersByTimeAsync(0);
    fake.on.error?.(new Error("net::ERR_INTERNET_DISCONNECTED"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.calls.check).toBe(1);
    // +14 min
    await vi.advanceTimersByTimeAsync(780_000);
    expect(fake.calls.check).toBe(1);
    // +15 min
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.calls.check).toBe(2);
    fake.on.notAvailable?.();
    expect(updates.status()).toStrictEqual({ state: "idle" });
    await vi.advanceTimersByTimeAsync(900_000);
    expect(fake.calls.check).toBe(2);
  });

  it("takes the failed-check retry delay from its deps", async () => {
    const fake = fakeUpdater();
    const updates = start(fake, { retryAfterMs: 120_000 });
    fake.on.error?.(new Error("ENOTFOUND"));
    expect(updates.status().state).toBe("failed");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.calls.check).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.calls.check).toBe(2);
  });

  it("installIfReady does nothing unless an update is downloaded", () => {
    let playing = true;
    const fake = fakeUpdater();
    const updates = start(fake, { isPlaying: () => playing });
    fake.on.available?.("0.3.0");
    updates.installIfReady();
    playing = false;
    vi.advanceTimersByTime(60_000);
    expect(updates.status().state).toBe("downloading");
    updates.installIfReady();
    expect(fake.calls.installs).toStrictEqual([]);
  });

  it("installIfReady installs silently without relaunch", () => {
    const releaseLock = vi.fn<() => void>();
    const fake = fakeUpdater();
    const updates = start(fake, { releaseLock });
    fake.on.downloaded?.("0.3.0");
    updates.installIfReady();
    expect(fake.calls.installs).toStrictEqual([false]);
    expect(releaseLock).not.toHaveBeenCalled();
  });

  it("marks the update failed when an install throws", () => {
    const fake = fakeUpdater();
    fake.failInstall();
    const updates = start(fake);
    fake.on.downloaded?.("0.3.0");
    expect(() => {
      updates.installIfReady();
    }).not.toThrow();
    expect(updates.status()).toStrictEqual({ state: "failed", message: "EACCES" });
  });

  it("fails and retries a download that rejects without an error event", async () => {
    const fake = fakeUpdater();
    fake.failDownloads(new Error("ECONNRESET"));
    const updates = start(fake);
    fake.on.available?.("0.3.0");
    await vi.advanceTimersByTimeAsync(0);
    expect(updates.status()).toStrictEqual({ state: "failed", message: "ECONNRESET" });
    await vi.advanceTimersByTimeAsync(900_000);
    expect(fake.calls.check).toBe(2);
  });

  it("stops a download when playback starts", async () => {
    let playing = false;
    const fake = fakeUpdater();
    fake.hangDownloadsUntilCancelled();
    const updates = start(fake, { isPlaying: () => playing });
    fake.on.available?.("0.3.0");
    fake.on.progress?.(20);
    expect(updates.status()).toStrictEqual({ state: "downloading", version: "0.3.0", percent: 20 });

    playing = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.calls.cancel).toBe(1);
    expect(updates.status()).toStrictEqual({ state: "available", version: "0.3.0" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.calls.cancel).toBe(1);
    expect(fake.calls.download).toBe(1);
  });

  it("resumes a stopped download once nothing plays", async () => {
    let playing = false;
    const fake = fakeUpdater();
    fake.hangDownloadsUntilCancelled();
    const updates = start(fake, { isPlaying: () => playing });
    fake.on.available?.("0.3.0");
    playing = true;
    await vi.advanceTimersByTimeAsync(60_000);

    playing = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.calls.download).toBe(2);
    expect(updates.status()).toStrictEqual({ state: "downloading", version: "0.3.0", percent: 0 });
  });

  it("does not cancel a download while nothing plays", async () => {
    const fake = fakeUpdater();
    fake.hangDownloadsUntilCancelled();
    const updates = start(fake);
    fake.on.available?.("0.3.0");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fake.calls.cancel).toBe(0);
    expect(updates.status().state).toBe("downloading");
  });

  it("reports failed and leaves the app running when createUpdater throws", () => {
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

    expect(updates.status()).toStrictEqual({
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

  it("restart quits only when an update is ready", () => {
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
    expect(fake.calls.installs).toStrictEqual([true]);
  });
});

describe(ownAppImage, () => {
  const appImage = "/apps/harakiri-x86_64.AppImage";

  it("is the AppImage when this process runs from its mount", () => {
    expect(
      ownAppImage({
        appImage,
        appDir: "/tmp/.mount_harakiAbC",
        execPath: "/tmp/.mount_harakiAbC/harakiri",
      })
    ).toBe(appImage);
  });

  it("ignores an APPIMAGE inherited from another AppImage's terminal", () => {
    expect(
      ownAppImage({
        appImage: "/apps/Terminal.AppImage",
        appDir: "/tmp/.mount_TerminXyZ",
        execPath: "/repo/apps/desktop/dist/linux-unpacked/harakiri",
      })
    ).toBeUndefined();
  });

  it("ignores an APPIMAGE without an APPDIR", () => {
    expect(
      ownAppImage({ appImage, appDir: undefined, execPath: "/tmp/.mount_harakiAbC/harakiri" })
    ).toBeUndefined();
  });

  it("ignores a mount that only shares a prefix with execPath", () => {
    expect(
      ownAppImage({
        appImage,
        appDir: "/tmp/.mount_harak",
        execPath: "/tmp/.mount_harakiAbC/harakiri",
      })
    ).toBeUndefined();
  });

  it("is undefined without an APPIMAGE", () => {
    expect(
      ownAppImage({
        appImage: undefined,
        appDir: "/tmp/.mount_harakiAbC",
        execPath: "/tmp/.mount_harakiAbC/harakiri",
      })
    ).toBeUndefined();
  });
});
