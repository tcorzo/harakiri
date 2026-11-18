// @vitest-environment node
import { EventEmitter } from "node:events";

import type { BaseUpdater, CancellationToken } from "electron-updater";
import { describe, expect, it, vi } from "vitest";

import { adaptUpdater } from "./updater";

function fakeUpdater() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    logger: null,
    checkForUpdates: vi.fn<() => Promise<null>>(async () => null),
    downloadUpdate: vi.fn<(token?: CancellationToken) => Promise<string[]>>(async () => []),
    install: vi.fn<(silent: boolean, relaunch: boolean) => boolean>(() => true),
  });
}

describe("adaptUpdater", () => {
  it("turns off auto download and install-on-quit and logs through logtape", () => {
    const fake = fakeUpdater();
    adaptUpdater(fake as unknown as BaseUpdater);
    expect(fake.autoDownload).toBe(false);
    expect(fake.autoInstallOnAppQuit).toBe(false);
    const logger = fake.logger as unknown as Record<string, unknown>;
    expect(typeof logger["info"]).toBe("function");
    expect(typeof logger["warn"]).toBe("function");
    expect(typeof logger["error"]).toBe("function");
  });

  it("maps events and calls", async () => {
    const fake = fakeUpdater();
    const updater = adaptUpdater(fake as unknown as BaseUpdater);
    const available = vi.fn<(v: string) => void>();
    const progress = vi.fn<(p: number) => void>();
    const downloaded = vi.fn<(v: string) => void>();
    const notAvailable = vi.fn<() => void>();
    const failed = vi.fn<(e: Error) => void>();
    updater.onAvailable(available);
    updater.onProgress(progress);
    updater.onDownloaded(downloaded);
    updater.onNotAvailable(notAvailable);
    updater.onError(failed);

    fake.emit("update-available", { version: "0.3.0" });
    fake.emit("download-progress", { percent: 12.5 });
    fake.emit("update-downloaded", { version: "0.3.0" });
    fake.emit("update-not-available", {});
    const error = new Error("x");
    fake.emit("error", error);

    expect(available).toHaveBeenCalledWith("0.3.0");
    expect(progress).toHaveBeenCalledWith(12.5);
    expect(downloaded).toHaveBeenCalledWith("0.3.0");
    expect(notAvailable).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith(error);

    await updater.check();
    await updater.download();
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(fake.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(updater.install(true)).toBe(true);
    expect(fake.install).toHaveBeenCalledWith(true, true);
  });

  it("cancels only the download in flight, and each download gets a fresh token", async () => {
    const fake = fakeUpdater();
    const updater = adaptUpdater(fake as unknown as BaseUpdater);
    expect(() => updater.cancelDownload()).not.toThrow();

    await updater.download();
    const first = fake.downloadUpdate.mock.calls[0]?.[0];
    expect(first).toBeDefined();
    expect(first?.cancelled).toBe(false);
    updater.cancelDownload();
    expect(first?.cancelled).toBe(true);

    await updater.download();
    const second = fake.downloadUpdate.mock.calls[1]?.[0];
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(second?.cancelled).toBe(false);
  });
});
