// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { gamescopeSession } from "../fixtures/environments";
import { launcherFiles, writeLauncher } from "./launcher";

const TARGET = "/usr/bin/sleep";
const EXEC_DEADLINE_MS = 3000;

/** Waits until `/proc/<pid>/exe` resolves to the target: the shell script has exec'd into it. */
const waitForExec = async (pid: number): Promise<void> => {
  await vi.waitFor(
    async () => {
      expect(path.basename(await readlink(`/proc/${pid}/exe`))).toBe(path.basename(TARGET));
    },
    { timeout: EXEC_DEADLINE_MS, interval: 20 }
  );
};

describe("the written Steam launcher in the guest", () => {
  it("drops LD_PRELOAD and becomes the target under the same PID", async () => {
    const files = launcherFiles(await mkdtemp(path.join(tmpdir(), "harakiri-launcher-")));

    await writeLauncher(
      files,
      TARGET,
      path.resolve(import.meta.dirname, "../../../../build/steam")
    );

    const child = spawn(files.script, ["30"], {
      env: {
        ...gamescopeSession,
        PATH: "/usr/bin:/bin",
        LD_PRELOAD: "/opt/fake/gameoverlayrenderer.so",
      },
      stdio: "ignore",
    });

    try {
      const { pid } = child;

      if (pid === undefined) {
        throw new Error("The launcher did not spawn.");
      }

      await waitForExec(pid);

      const environText = await readFile(`/proc/${pid}/environ`, "utf-8");
      const environ = environText.split("\0");

      expect(environ.some((entry) => entry.startsWith("LD_PRELOAD="))).toBe(false);
      expect(environ).toContain("XDG_CURRENT_DESKTOP=gamescope");
    } finally {
      child.kill();
    }
  });
});
