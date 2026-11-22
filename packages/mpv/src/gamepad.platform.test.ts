// @vitest-environment node
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { bundledMpv } from "./bundle";

const PAD_SOCKET = "/run/harakiri/pad.sock";

/** One request to the guest's pad daemon (dev/vm/pad.py). Throws on an `error ...` reply. */
const padCommand = async (line: string): Promise<string> => {
  const socket = connect(PAD_SOCKET);
  await once(socket, "connect");
  socket.write(`${line}\n`);

  // The daemon answers one line and closes the connection.
  socket.setEncoding("utf-8");
  let text = "";

  for await (const chunk of socket) {
    text += String(chunk);
  }

  const reply = text.trim();

  if (reply === "") {
    throw new Error(`pad ${line}: the daemon closed the socket without a reply`);
  }

  if (reply.startsWith("error")) {
    throw new Error(`pad ${line}: ${reply}`);
  }

  return reply;
};

const tail = (lines: string[]): string => lines.slice(-20).join("\n");

/** Collect a child's stdout and stderr lines as they arrive. */
const collect = (child: ChildProcess): string[] => {
  const lines: string[] = [];

  for (const stream of [child.stdout, child.stderr]) {
    if (stream) {
      createInterface({ input: stream }).on("line", (line) => {
        lines.push(line);
      });
    }
  }

  return lines;
};

const lineMatching = async (
  child: ChildProcess,
  lines: string[],
  pattern: RegExp,
  ms: number
): Promise<string> => {
  const deadline = Date.now() + ms;

  while (Date.now() < deadline) {
    const found = lines.find((line) => pattern.test(line));

    if (found !== undefined) {
      return found;
    }

    if (child.exitCode !== null) {
      throw new Error(
        `mpv exited ${child.exitCode} before ${pattern}. Last 20 lines:\n${tail(lines)}`
      );
    }

    // oxlint-disable-next-line eslint/no-await-in-loop -- polling a growing line buffer
    await sleep(50);
  }

  throw new Error(`no line matched ${pattern} in ${ms} ms. Last 20 lines:\n${tail(lines)}`);
};

const exitCode = async (
  child: ChildProcess,
  lines: string[],
  ms: number
): Promise<number | null> => {
  if (child.exitCode !== null) {
    return child.exitCode;
  }

  try {
    await once(child, "exit", { signal: AbortSignal.timeout(ms) });

    return child.exitCode;
  } catch {
    child.kill("SIGKILL");
    throw new Error(`mpv did not exit in ${ms} ms. Last 20 lines:\n${tail(lines)}`);
  }
};

describe("a virtual pad in the guest", () => {
  it("a pad's BTN_SOUTH reaches mpv as GAMEPAD_ACTION_DOWN", async () => {
    // A killed run leaves its pad plugged in the daemon, and plug refuses a second one. The daemon
    // answers ok to an unplug with nothing plugged.
    await padCommand("unplug");
    let dir: string | undefined;
    let mpv: ChildProcess | undefined;

    try {
      dir = await mkdtemp(path.join(tmpdir(), "harakiri-pad-"));
      const conf = path.join(dir, "input.conf");
      await writeFile(conf, "GAMEPAD_ACTION_DOWN quit 42\n");
      await expect(padCommand("plug")).resolves.toMatch(/^ok \/dev\/input\/event\d+$/u);
      // session.sh sets SDL_JOYSTICK_DISABLE_UDEV, so SDL scans /dev/input. The pad reaches the
      // build's own SDL2.
      mpv = spawn(bundledMpv(), [
        "--no-config",
        "--idle=yes",
        "--vo=null",
        "--ao=null",
        "--input-gamepad=yes",
        `--input-conf=${conf}`,
        "--msg-level=all=v",
      ]);
      const lines = collect(mpv);
      // SDL2's own mapping name for the pad. Fedora's SDL3-backed SDL2 calls it "Xbox 360 Controller".
      await lineMatching(mpv, lines, /added controller: X360 Controller$/u, 10_000);
      await expect(padCommand("press BTN_SOUTH")).resolves.toBe("ok");
      await expect(exitCode(mpv, lines, 10_000)).resolves.toBe(42);
    } finally {
      mpv?.kill("SIGKILL");

      if (dir !== undefined) {
        await rm(dir, { recursive: true, force: true });
      }

      await padCommand("unplug");
    }
  }, 30_000);
});
