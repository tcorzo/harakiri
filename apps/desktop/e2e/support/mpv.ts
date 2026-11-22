import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";

import { bundledMpv } from "@harakiri/mpv";
import { z } from "zod";

export interface MpvProcess {
  readonly pid: number;
  /** argv[0]: the executable the app spawned. */
  readonly binary: string;
  readonly ipcSocket: string | undefined;
}

/**
 * The mpv processes the app launched for one profile. Main spawns mpv with
 * `--config-dir=<userData>/mpv`, so the profile's dir identifies this run's mpv and nobody else's.
 */
export const mpvProcesses = (userDataDir: string): MpvProcess[] => {
  const configArg = `--config-dir=${path.join(userDataDir, "mpv")}`;
  const found: MpvProcess[] = [];

  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/u.test(entry)) {
      continue;
    }

    let argv: string[];

    try {
      argv = readFileSync(`/proc/${entry}/cmdline`, "utf-8").split("\0");
    } catch {
      continue;
    }

    if (!argv.includes(configArg)) {
      continue;
    }

    const ipc = argv.find((arg) => arg.startsWith("--input-ipc-server="));
    found.push({
      pid: Number(entry),
      binary: argv[0] ?? "",
      ipcSocket: ipc?.slice("--input-ipc-server=".length),
    });
  }

  return found;
};

const Reply = z.object({
  request_id: z.number().optional(),
  error: z.string().optional(),
  data: z.json().optional(),
  event: z.string().optional(),
});

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Sends `command` to the profile's running mpv over its own IPC socket, as a second client, and
 * resolves with its reply or, with `untilEvent`, once mpv sends that event to every client after
 * the reply.
 */
const send = async (
  userDataDir: string,
  command: JsonValue[],
  untilEvent?: string
): Promise<JsonValue | undefined> => {
  const [mpv, ...others] = mpvProcesses(userDataDir);

  if (mpv?.ipcSocket === undefined || mpv.ipcSocket === "" || others.length > 0) {
    throw new Error(
      `Expected exactly one mpv with an IPC socket, found ${others.length + (mpv ? 1 : 0)}`
    );
  }

  const socket = connect(mpv.ipcSocket);

  try {
    await once(socket, "connect");
    const requestId = Math.floor(Math.random() * 2 ** 31);

    // oxlint-disable-next-line promise/avoid-new -- wraps a line-event stream and a timer, which have no promise form
    const reply = new Promise<JsonValue | undefined>((resolve, reject) => {
      const awaited = untilEvent === undefined ? "answer" : `send ${untilEvent} after`;

      const timer = setTimeout(() => {
        reject(new Error(`mpv did not ${awaited} ${JSON.stringify(command)}`));
      }, 5000);

      let answer: { readonly data: JsonValue | undefined } | undefined;

      createInterface({ input: socket }).on("line", (line) => {
        const message = Reply.safeParse(JSON.parse(line));

        if (!message.success) {
          return;
        }

        if (message.data.request_id === requestId) {
          if (message.data.error !== "success") {
            clearTimeout(timer);
            reject(new Error(`mpv ${JSON.stringify(command)}: ${message.data.error}`));

            return;
          }

          answer = { data: message.data.data };
        }

        if (
          answer !== undefined &&
          (untilEvent === undefined || message.data.event === untilEvent)
        ) {
          clearTimeout(timer);
          resolve(answer.data);
        }
      });
    });

    socket.write(`${JSON.stringify({ command, request_id: requestId })}\n`);

    return await reply;
  } finally {
    socket.destroy();
  }
};

/** Sends one command to the profile's running mpv as a second client, and returns its reply. */
export const mpvCommand = async (
  userDataDir: string,
  ...command: JsonValue[]
): Promise<JsonValue | undefined> => await send(userDataDir, command);

/**
 * Presses `key` in the profile's mpv. `keypress <KEY>` goes through the app's input.conf, so it
 * exercises the same binding and `script-message harakiri <action>` path a remote or gamepad
 * press does. With `untilEvent`, it resolves once mpv sends that event after the press, such as
 * the `playback-restart` that ends a seek.
 */
export const pressKey = async (userDataDir: string, key: string, untilEvent?: string) =>
  await send(userDataDir, ["keypress", key], untilEvent);

/**
 * Lavapipe's Vulkan device UUID. libplacebo skips software devices unless one is named, and the
 * name has spaces that HARAKIRI_MPV_ARGS cannot carry, so the UUID names it. It encodes the Mesa
 * version, so it is read from mpv rather than written down.
 */
export const lavapipeDeviceUuid = (): string => {
  const list = execFileSync(bundledMpv(), ["--no-config", "--vulkan-device=help"], {
    encoding: "utf-8",
  });

  const uuid = /'llvmpipe[^']*'.*UUID (?<uuid>[0-9a-f-]{36})/u.exec(list)?.groups?.uuid;

  if (uuid === undefined) {
    throw new Error(`mpv lists no lavapipe Vulkan device:\n${list}`);
  }

  return uuid;
};
