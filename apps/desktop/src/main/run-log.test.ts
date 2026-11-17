import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LogRecord } from "@logtape/logtape";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openRunLog } from "./run-log";

const record = (message: string): LogRecord => ({
  category: ["harakiri", "player"],
  level: "warning",
  message: [message],
  rawMessage: message,
  timestamp: Date.UTC(2026, 9, 30, 11, 2, 3),
  properties: {},
});

describe(openRunLog, () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "harakiri-run-log-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("each line is on disk as soon as it is logged, in a file only the owner can read", async () => {
    const { path: logPath, sink } = openRunLog(dir, new Date(Date.UTC(2026, 9, 30, 11, 2, 3)));
    sink(record("mpv: [ao/pipewire] no target node available"));
    expect(logPath).toBe(path.join(dir, `harakiri-2026-10-30T11-02-03-${process.pid}.log`));
    await expect(readFile(logPath, "utf-8")).resolves.toBe(
      "2026-10-30 11:02:03.000 +00 [WRN] harakiri·player: mpv: [ao/pipewire] no target node available\n"
    );
    const { mode } = await stat(logPath);
    expect(mode.toString(8).slice(-3)).toBe("600");
    sink[Symbol.dispose]();
  });

  it("only the newest runs are kept, and files that are not run logs are left alone", async () => {
    await Promise.all(
      ["01", "02", "03"].map(async (day) => {
        await writeFile(path.join(dir, `harakiri-2026-10-${day}T09-00-00-1.log`), "old\n");
      })
    );

    await writeFile(path.join(dir, "notes.txt"), "mine\n");
    const { sink } = openRunLog(dir, new Date(Date.UTC(2026, 9, 30, 11, 2, 3)), 2);
    sink[Symbol.dispose]();
    const names = await readdir(dir);
    expect(names.toSorted()).toStrictEqual([
      "harakiri-2026-10-03T09-00-00-1.log",
      `harakiri-2026-10-30T11-02-03-${process.pid}.log`,
      "notes.txt",
    ]);
  });
});
