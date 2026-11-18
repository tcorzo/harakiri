// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { holdQuitUntilStopped, removeStaleMpvDirs, stopWithin } from "./lifecycle";

const uid = process.getuid?.() ?? -1;
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);

const hang = async () => {
  await Promise.withResolvers<undefined>().promise;
};

const fakeApp = () => {
  let listener: ((event: { preventDefault: () => void }) => void) | undefined;
  const exits: number[] = [];

  return {
    exits,
    app: {
      on: (_name: "before-quit", l: (event: { preventDefault: () => void }) => void) => {
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
};

describe(removeStaleMpvDirs, () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "harakiri-lifecycle-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const makeDir = (name: string, ageMs: number): void => {
    const dirPath = path.join(dir, name);
    mkdirSync(dirPath);
    writeFileSync(path.join(dirPath, "ipc.sock"), "");
    const at = new Date(NOW - ageMs);
    utimesSync(dirPath, at, at);
  };

  it("removes old harakiri-mpv dirs this user owns and keeps fresh or unrelated ones", () => {
    makeDir("harakiri-mpv-old", 120_000);
    makeDir("harakiri-mpv-fresh", 10_000);
    makeDir("other-old", 120_000);
    writeFileSync(path.join(dir, "harakiri-mpv-file"), "");
    utimesSync(path.join(dir, "harakiri-mpv-file"), new Date(0), new Date(0));

    const removed = removeStaleMpvDirs({ dir, uid, now: NOW, minAgeMs: 60_000 });

    expect(removed).toStrictEqual([path.join(dir, "harakiri-mpv-old")]);
    expect(readdirSync(dir).toSorted()).toStrictEqual([
      "harakiri-mpv-file",
      "harakiri-mpv-fresh",
      "other-old",
    ]);
  });

  it("leaves dirs owned by another user", () => {
    makeDir("harakiri-mpv-theirs", 120_000);

    expect(removeStaleMpvDirs({ dir, uid: uid + 1, now: NOW, minAgeMs: 60_000 })).toStrictEqual([]);
    expect(readdirSync(dir)).toStrictEqual(["harakiri-mpv-theirs"]);
  });
});

describe(stopWithin, () => {
  it("reports a stop, a failure and a hang", async () => {
    await expect(
      stopWithin(async () => {
        await Promise.resolve();
      }, 1000)
    ).resolves.toBe("stopped");
    await expect(
      stopWithin(async () => {
        await Promise.reject(new Error("boom"));
      }, 1000)
    ).resolves.toBe("failed");
    await expect(stopWithin(hang, 20)).resolves.toBe("timed-out");
  });
});

describe(holdQuitUntilStopped, () => {
  it("waits for the player to stop, then exits once", async () => {
    const { app, exits, quit } = fakeApp();
    const { promise: stopped, resolve: finishStop } = Promise.withResolvers<undefined>();
    let stops = 0;
    holdQuitUntilStopped(app, async () => {
      stops += 1;
      await stopped;
    });

    expect(quit()).toBe("prevented");
    expect(quit()).toBe("prevented");
    await Promise.resolve();
    expect(exits).toStrictEqual([]);

    finishStop(undefined);
    await delay(0);
    expect(exits).toStrictEqual([0]);
    expect(stops).toBe(1);
  });

  it("exits after the cap when the player hangs", async () => {
    const { app, exits, quit } = fakeApp();
    holdQuitUntilStopped(app, hang, { capMs: 20 });

    quit();
    await delay(60);
    expect(exits).toStrictEqual([0]);
  });

  it("runs afterStop once, after the player stopped and before exit", async () => {
    const { app, exits, quit } = fakeApp();
    const order: string[] = [];
    holdQuitUntilStopped(
      app,
      async () => {
        order.push("stop");
        await Promise.resolve();
      },
      {
        afterStop: () => {
          order.push(`afterStop exits=${exits.length}`);
        },
      }
    );

    quit();
    quit();
    await delay(0);
    expect(order).toStrictEqual(["stop", "afterStop exits=0"]);
    expect(exits).toStrictEqual([0]);
  });

  it("still exits when afterStop throws", async () => {
    const { app, exits, quit } = fakeApp();
    holdQuitUntilStopped(
      app,
      async () => {
        await Promise.resolve();
      },
      {
        afterStop: () => {
          throw new Error("install failed");
        },
      }
    );

    quit();
    await delay(0);
    expect(exits).toStrictEqual([0]);
  });
});
