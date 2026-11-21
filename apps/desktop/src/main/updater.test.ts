// @vitest-environment node
import { EventEmitter } from "node:events";

import { configure, reset as resetLogging } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import type { BaseUpdater, CancellationToken } from "electron-updater";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { adaptUpdater } from "./updater";

const fakeUpdater = () => {
  // oxlint-disable-next-line unicorn/prefer-event-target -- electron-updater's updater is an EventEmitter, and the double mirrors its `on` and `emit`
  const emitter = new EventEmitter();

  const loggerSlot: Pick<BaseUpdater, "logger"> = { logger: null };

  return Object.assign(emitter, loggerSlot, {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn<() => Promise<null>>(async () => await Promise.resolve(null)),
    downloadUpdate: vi.fn<(token?: CancellationToken) => Promise<string[]>>(
      async () => await Promise.resolve([])
    ),
    install: vi.fn<(silent: boolean, relaunch: boolean) => boolean>(() => true),
  });
};

const ISSUE_15_MESSAGE =
  "Error: HttpError: 404 \n" +
  '"method: GET url: https://github.com/example/app/releases.atom\\n\\nPlease double check that your authentication token is correct. Due to security reasons, actual status maybe not reported, but 404.\\n"\n';

describe(adaptUpdater, () => {
  const records: LogRecord[] = [];

  beforeAll(async () => {
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
  });

  afterAll(async () => {
    await resetLogging();
  });

  it("logs a 404 from the feed at debug and any other error at error", () => {
    const fake = fakeUpdater();
    adaptUpdater(fake);
    records.length = 0;

    fake.logger?.error(ISSUE_15_MESSAGE);
    expect(records.filter((r) => r.level === "error")).toStrictEqual([]);
    expect(records.filter((r) => r.level === "debug")).toHaveLength(1);

    fake.logger?.error("Error: EACCES");
    expect(records.filter((r) => r.level === "error")).toHaveLength(1);
  });

  it("turns off auto download and install-on-quit and logs through logtape", () => {
    const fake = fakeUpdater();
    adaptUpdater(fake);

    expect(fake.autoDownload).toBe(false);
    expect(fake.autoInstallOnAppQuit).toBe(false);
    expect(Object.keys(fake.logger ?? {}).toSorted()).toStrictEqual(["error", "info", "warn"]);
  });

  it("maps updater events to listeners", () => {
    const fake = fakeUpdater();
    const updater = adaptUpdater(fake);
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
    expect(notAvailable).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledWith(error);
  });

  it("forwards check, download and install", async () => {
    const fake = fakeUpdater();
    const updater = adaptUpdater(fake);

    await updater.check();
    await updater.download();

    expect(fake.checkForUpdates).toHaveBeenCalledOnce();
    expect(fake.downloadUpdate).toHaveBeenCalledOnce();
    expect(updater.install(true)).toBe(true);
    expect(fake.install).toHaveBeenCalledWith(true, true);
  });

  it("cancels nothing before a download starts", () => {
    const updater = adaptUpdater(fakeUpdater());

    expect(() => {
      updater.cancelDownload();
    }).not.toThrow();
  });

  it("cancels the download in flight", async () => {
    const fake = fakeUpdater();
    const updater = adaptUpdater(fake);

    await updater.download();
    const first = fake.downloadUpdate.mock.calls[0]?.[0];
    expect(first).toBeDefined();
    expect(first?.cancelled).toBe(false);
    updater.cancelDownload();
    expect(first?.cancelled).toBe(true);
  });

  it("gives each download a fresh token", async () => {
    const fake = fakeUpdater();
    const updater = adaptUpdater(fake);

    await updater.download();
    updater.cancelDownload();
    await updater.download();
    const first = fake.downloadUpdate.mock.calls[0]?.[0];
    const second = fake.downloadUpdate.mock.calls[1]?.[0];
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(second?.cancelled).toBe(false);
  });
});
