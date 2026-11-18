import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

import { getLogger } from "@logtape/logtape";
import type { z } from "zod";

import { configArg, type MpvConfig } from "./args";
import {
  createLineSplitter,
  encodeRequest,
  parseInboundLine,
  type InboundMessage,
  type JsonValue,
  type MpvEvent,
  type Reply,
} from "./protocol";

const logger = getLogger(["harakiri", "mpv"]);

export type { JsonValue, MpvEvent };

export type Unsubscribe = () => void;

export interface MpvExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface MpvSpawnOptions {
  /** Emitted first, as `--config-dir=<dir>` or `--no-config`. */
  readonly config: MpvConfig;
  /** Path to the mpv executable. Defaults to `mpv` on PATH. */
  readonly binary?: string;
  /** Extra mpv arguments, e.g. from `buildPlaybackArgs`. Never a secret: argv is world-readable. */
  readonly args?: readonly string[];
  readonly socketTimeoutMs?: number;
  /** Default 10 s. See `MpvClient.command`. */
  readonly requestTimeoutMs?: number;
}

export interface MpvClient {
  readonly pid: number;
  readonly exited: Promise<MpvExit>;
  /**
   * Rejects with `MpvTimeoutError` when mpv does not answer within `requestTimeoutMs`, and then
   * SIGKILLs mpv: an mpv that stops answering IPC is treated as dead, so `exited` settles.
   */
  command(...args: JsonValue[]): Promise<unknown>;
  getProperty<T>(name: string, schema: z.ZodType<T>): Promise<T>;
  setProperty(name: string, value: JsonValue): Promise<void>;
  /** `onChange` receives `undefined` while mpv reports the property as unavailable. */
  observeProperty<T>(
    name: string,
    schema: z.ZodType<T>,
    onChange: (value: T | undefined) => void
  ): Promise<Unsubscribe>;
  onEvent(listener: (event: MpvEvent) => void): Unsubscribe;
  onClientMessage(listener: (args: readonly string[]) => void): Unsubscribe;
  /** Asks mpv to quit, SIGKILLs it after `timeoutMs`, and removes the socket dir. */
  quit(timeoutMs?: number): Promise<MpvExit>;
}

/**
 * The name of an mpv command, and nothing else. Its arguments carry stream and sidecar URLs with
 * `api_key`/`ApiKey` and the Authorization header value, so an error or a log line that quoted
 * them would print the token; keeping only the verb makes that impossible for every caller.
 */
function commandName(command: readonly JsonValue[]): string {
  const [verb] = command;

  return typeof verb === "string" ? redactSecrets(verb) : "(unnamed)";
}

export class MpvCommandError extends Error {
  /** The command's name only, e.g. `loadfile`; never its arguments. */
  readonly command: string;
  readonly mpvError: string;
  constructor(command: readonly JsonValue[], mpvError: string) {
    const name = commandName(command);
    super(`mpv command ${JSON.stringify(name)} failed: ${mpvError}`);
    this.name = "MpvCommandError";
    this.command = name;
    this.mpvError = mpvError;
  }
}

export class MpvTimeoutError extends Error {
  /** The command's name only, e.g. `sub-add`; never its arguments. */
  readonly command: string;
  readonly timeoutMs: number;
  constructor(command: readonly JsonValue[], timeoutMs: number) {
    const name = commandName(command);
    super(`mpv did not answer ${JSON.stringify(name)} within ${timeoutMs}ms`);
    this.name = "MpvTimeoutError";
    this.command = name;
    this.timeoutMs = timeoutMs;
  }
}

export class MpvClosedError extends Error {
  constructor() {
    super("mpv IPC connection closed");
    this.name = "MpvClosedError";
  }
}

interface Pending {
  /** The command's name only: a pending request must not hold the URLs it was sent with. */
  readonly command: string;
  readonly resolve: (data: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

const secretParam = /\b(ApiKey|api_key|X-Emby-Token)=[^&\s'"]+/gi;

// Verbose mpv echoes `Set property: http-header-fields=["Authorization: MediaBrowser Token=\"…\""]`.
const tokenField = /\b(Token=)(\\?")?[^"\s,\\]+/g;

/**
 * mpv echoes URLs it opens, where Jellyfin sidecar and stream URLs carry the token as a query
 * param, and verbose mpv echoes the Authorization header it was given.
 */
export function redactSecrets(line: string): string {
  return line.replace(secretParam, "$1=REDACTED").replace(tokenField, "$1$2REDACTED");
}

export async function spawnMpv(options: MpvSpawnOptions): Promise<MpvClient> {
  const dir = await mkdtemp(join(tmpdir(), "harakiri-mpv-"));
  const socketPath = join(dir, "ipc.sock");

  const child = spawn(
    options.binary ?? "mpv",
    [
      configArg(options.config),
      "--idle=yes",
      ...(options.args ?? []),
      `--input-ipc-server=${socketPath}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  // Off a terminal, mpv writes its log messages to stdout, not stderr.
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => {
      logger.debug("mpv: {line}", { line: redactSecrets(line) });
    });
  }

  let exit: MpvExit | undefined;

  const exited = new Promise<MpvExit>((resolve) => {
    child.once("exit", (code, signal) => {
      exit = { code, signal };
      resolve(exit);
    });
  });

  const cleanedUp = exited.then(() => rm(dir, { recursive: true, force: true }));

  const spawnFailed = new Promise<never>((_, reject) => {
    child.once("error", reject);
    void exited.then((e) =>
      reject(new Error(`mpv exited before its IPC socket was ready (code ${e.code})`))
    );
  });

  let socket: Socket;

  try {
    socket = await Promise.race([
      connectWhenReady(socketPath, options.socketTimeoutMs ?? 5000, () => exit !== undefined),
      spawnFailed,
    ]);
  } catch (error) {
    child.kill("SIGKILL");
    // A spawn error (e.g. ENOENT) never emits `exit`, so the dir cleanup above would not run.
    await rm(dir, { recursive: true, force: true });
    throw error;
  }

  spawnFailed.catch(() => {});

  return createClient({
    socket,
    pid: child.pid ?? -1,
    exited,
    cleanedUp,
    kill: (signal) => child.kill(signal),
    requestTimeoutMs: options.requestTimeoutMs ?? 10_000,
  });
}

async function connectWhenReady(
  path: string,
  timeoutMs: number,
  hasExited: () => boolean
): Promise<Socket> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      return await connectOnce(path);
    } catch (error) {
      if (hasExited()) {
        throw error;
      }

      if (Date.now() > deadline) {
        throw new Error(`mpv IPC socket ${path} not ready after ${timeoutMs}ms`, { cause: error });
      }

      await delay(20);
    }
  }
}

function connectOnce(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.off("error", reject);
      resolve(socket);
    });
  });
}

interface Connection {
  readonly socket: Socket;
  readonly pid: number;
  readonly exited: Promise<MpvExit>;
  readonly cleanedUp: Promise<void>;
  readonly kill: (signal: NodeJS.Signals) => void;
  readonly requestTimeoutMs: number;
}

function createClient({
  socket,
  pid,
  exited,
  cleanedUp,
  kill,
  requestTimeoutMs,
}: Connection): MpvClient {
  const pending = new Map<number, Pending>();
  const eventListeners = new Set<(event: MpvEvent) => void>();
  const clientMessageListeners = new Set<(args: readonly string[]) => void>();
  const propertyHandlers = new Map<number, (data: unknown) => void>();
  let nextRequestId = 1;
  let nextObserveId = 1;
  let closed = false;

  const settle = (reply: Reply) => {
    const request = pending.get(reply.request_id);

    if (!request) {
      return;
    }
    pending.delete(reply.request_id);
    clearTimeout(request.timer);

    if (reply.error === "success") {
      request.resolve(reply.data);
    } else {
      request.reject(new MpvCommandError([request.command], reply.error));
    }
  };

  const dispatch = (message: InboundMessage) => {
    switch (message.kind) {
      case "reply":
        return settle(message.reply);
      case "property-change":
        propertyHandlers.get(message.change.id)?.(message.change.data);
        break;
      case "client-message":
        for (const listener of clientMessageListeners) {
          listener(message.args);
        }
        break;
    }

    for (const listener of eventListeners) {
      listener(message.event);
    }
  };

  socket.setEncoding("utf8");
  socket.on(
    "data",
    createLineSplitter((line) => {
      let message;

      try {
        message = parseInboundLine(line);
      } catch (error) {
        logger.error("Unparseable mpv IPC message {line}: {error}", {
          line: redactSecrets(line),
          error,
        });

        return;
      }

      dispatch(message);
    })
  );
  socket.on("error", (error) => {
    logger.warn("mpv IPC socket error: {error}", { error });
  });
  socket.on("close", () => {
    closed = true;

    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new MpvClosedError());
    }

    pending.clear();
  });
  void exited.then(() => socket.destroy());

  const command = (...args: JsonValue[]): Promise<unknown> => {
    if (closed) {
      return Promise.reject(new MpvClosedError());
    }
    const requestId = nextRequestId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new MpvTimeoutError(args, requestTimeoutMs));
        kill("SIGKILL");
      }, requestTimeoutMs);

      pending.set(requestId, { command: commandName(args), resolve, reject, timer });

      try {
        socket.write(encodeRequest({ command: args, request_id: requestId }));
      } catch (error) {
        pending.delete(requestId);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const subscribe = <T>(set: Set<T>, listener: T): Unsubscribe => {
    set.add(listener);

    return () => set.delete(listener);
  };

  return {
    pid,
    exited,
    command,

    async getProperty(name, schema) {
      return schema.parse(await command("get_property", name));
    },

    async setProperty(name, value) {
      await command("set_property", name, value);
    },

    async observeProperty(name, schema, onChange) {
      const id = nextObserveId++;
      propertyHandlers.set(id, (data) => {
        if (data === undefined) {
          return onChange(undefined);
        }
        const parsed = schema.safeParse(data);

        if (parsed.success) {
          onChange(parsed.data);
        } else {
          logger.error("mpv property {name} failed validation: {error}", {
            name,
            error: parsed.error,
          });
        }
      });

      try {
        await command("observe_property", id, name);
      } catch (error) {
        propertyHandlers.delete(id);
        throw error;
      }

      return () => {
        if (!propertyHandlers.delete(id)) {
          return;
        }
        command("unobserve_property", id).catch(() => {});
      };
    },

    onEvent: (listener) => subscribe(eventListeners, listener),

    onClientMessage: (listener) => subscribe(clientMessageListeners, listener),

    async quit(timeoutMs = 3000) {
      // mpv may close the socket before replying to `quit`.
      command("quit").catch(() => {});
      const timer = setTimeout(() => kill("SIGKILL"), timeoutMs);
      const result = await exited;
      clearTimeout(timer);
      await cleanedUp;

      return result;
    },
  };
}
