// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { holdQuitUntilStopped, removeStaleMpvDirs, stopWithin } from "./lifecycle";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "harakiri-lifecycle-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const uid = process.getuid?.() ?? -1;
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);

function makeDir(name: string, ageMs: number): void {
  const path = join(dir, name);
  mkdirSync(path);
  writeFileSync(join(path, "ipc.sock"), "");
  const at = new Date(NOW - ageMs);
  utimesSync(path, at, at);
}

test("removes old harakiri-mpv dirs this user owns and keeps fresh or unrelated ones", () => {
  makeDir("harakiri-mpv-old", 120_000);
  makeDir("harakiri-mpv-fresh", 10_000);
  makeDir("other-old", 120_000);
  writeFileSync(join(dir, "harakiri-mpv-file"), "");
  utimesSync(join(dir, "harakiri-mpv-file"), new Date(0), new Date(0));

  const removed = removeStaleMpvDirs({ dir, uid, now: NOW, minAgeMs: 60_000 });

  expect(removed).toEqual([join(dir, "harakiri-mpv-old")]);
  expect(readdirSync(dir).toSorted()).toEqual([
    "harakiri-mpv-file",
    "harakiri-mpv-fresh",
    "other-old",
  ]);
});

test("leaves dirs owned by another user", () => {
  makeDir("harakiri-mpv-theirs", 120_000);

  expect(removeStaleMpvDirs({ dir, uid: uid + 1, now: NOW, minAgeMs: 60_000 })).toEqual([]);
  expect(readdirSync(dir)).toEqual(["harakiri-mpv-theirs"]);
});

test("stopWithin reports a stop, a failure and a hang", async () => {
  await expect(stopWithin(() => Promise.resolve(), 1000)).resolves.toBe("stopped");
  await expect(stopWithin(() => Promise.reject(new Error("boom")), 1000)).resolves.toBe("failed");
  await expect(stopWithin(() => new Promise(() => {}), 20)).resolves.toBe("timed-out");
});

function fakeApp() {
  let listener: ((event: { preventDefault(): void }) => void) | undefined;
  const exits: number[] = [];
  return {
    exits,
    app: {
      on: (_name: "before-quit", l: (event: { preventDefault(): void }) => void) => {
        listener = l;
      },
      exit: (code = 0) => {
        exits.push(code);
      },
    },
    quit: (): "prevented" | "allowed" => {
      let prevented = false;
      listener?.({
        preventDefault: () => {
          prevented = true;
        },
      });
      return prevented ? "prevented" : "allowed";
    },
  };
}

test("quit waits for the player to stop, then exits once", async () => {
  const { app, exits, quit } = fakeApp();
  const { promise: stopped, resolve: finishStop } = Promise.withResolvers<void>();
  let stops = 0;
  holdQuitUntilStopped(app, () => {
    stops += 1;
    return stopped;
  });

  expect(quit()).toBe("prevented");
  expect(quit()).toBe("prevented");
  await Promise.resolve();
  expect(exits).toEqual([]);

  finishStop();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(exits).toEqual([0]);
  expect(stops).toBe(1);
});

test("quit exits after the cap when the player hangs", async () => {
  const { app, exits, quit } = fakeApp();
  holdQuitUntilStopped(app, () => new Promise(() => {}), { capMs: 20 });

  quit();
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(exits).toEqual([0]);
});

test("afterStop runs once, after the player stopped and before exit", async () => {
  const { app, exits, quit } = fakeApp();
  const order: string[] = [];
  holdQuitUntilStopped(app, async () => void order.push("stop"), {
    afterStop: () => void order.push(`afterStop exits=${exits.length}`),
  });

  quit();
  quit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(order).toEqual(["stop", "afterStop exits=0"]);
  expect(exits).toEqual([0]);
});

test("a throwing afterStop still exits", async () => {
  const { app, exits, quit } = fakeApp();
  holdQuitUntilStopped(app, () => Promise.resolve(), {
    afterStop: () => {
      throw new Error("install failed");
    },
  });

  quit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(exits).toEqual([0]);
});
