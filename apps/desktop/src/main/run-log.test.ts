import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogRecord } from "@logtape/logtape";
import { afterEach, beforeEach, expect, test } from "vitest";
import { openRunLog } from "./run-log";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "harakiri-run-log-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const record = (message: string): LogRecord => ({
  category: ["harakiri", "player"],
  level: "warning",
  message: [message],
  rawMessage: message,
  timestamp: Date.UTC(2026, 9, 30, 11, 2, 3),
  properties: {},
});

test("each line is on disk as soon as it is logged, in a file only the owner can read", async () => {
  const { path, sink } = openRunLog(dir, new Date(Date.UTC(2026, 9, 30, 11, 2, 3)));
  sink(record("mpv: [ao/pipewire] no target node available"));
  expect(path).toBe(join(dir, `harakiri-2026-10-30T11-02-03-${process.pid}.log`));
  expect(await readFile(path, "utf8")).toBe(
    "2026-10-30 11:02:03.000 +00 [WRN] harakiri·player: mpv: [ao/pipewire] no target node available\n",
  );
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  sink[Symbol.dispose]();
});

test("only the newest runs are kept, and files that are not run logs are left alone", async () => {
  for (const day of ["01", "02", "03"]) {
    await writeFile(join(dir, `harakiri-2026-10-${day}T09-00-00-1.log`), "old\n");
  }
  await writeFile(join(dir, "notes.txt"), "mine\n");
  const { sink } = openRunLog(dir, new Date(Date.UTC(2026, 9, 30, 11, 2, 3)), 2);
  sink[Symbol.dispose]();
  expect((await readdir(dir)).toSorted()).toEqual([
    "harakiri-2026-10-03T09-00-00-1.log",
    `harakiri-2026-10-30T11-02-03-${process.pid}.log`,
    "notes.txt",
  ]);
});
