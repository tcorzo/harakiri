import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

import { getLogger } from "@logtape/logtape";
import type { z } from "zod";

import { configArg } from "./args";
import type { MpvConfig } from "./args";
import { MpvClosedError } from "./closed-error";
import { MpvCommandError } from "./command-error";
import { createLineSplitter, encodeRequest, parseInboundLine } from "./protocol";
import type { InboundMessage, JsonValue, MpvEvent, Reply } from "./protocol";
import { commandName, redactSecrets } from "./redact";
import { MpvTimeoutError } from "./timeout-error";

const logger = getLogger(["harakiri", "mpv"]);

export type { JsonValue, MpvEvent };

export { MpvClosedError, MpvCommandError, MpvTimeoutError, redactSecrets };

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
  readonly command: (...args: JsonValue[]) => Promise<JsonValue | undefined>;
  readonly getProperty: <T>(name: string, schema: z.ZodType<T>) => Promise<T>;
  readonly setProperty: (name: string, value: JsonValue) => Promise<void>;
  /** `onChange` receives `undefined` while mpv reports the property as unavailable. */
  readonly observeProperty: <T>(
    name: string,
    schema: z.ZodType<T>,
    onChange: (value: T | undefined) => void
  ) => Promise<Unsubscribe>;
  readonly onEvent: (listener: (event: MpvEvent) => void) => Unsubscribe;
  readonly onClientMessage: (listener: (args: readonly string[]) => void) => Unsubscribe;
  /** Asks mpv to quit, SIGKILLs it after `timeoutMs`, and removes the socket dir. */
  readonly quit: (timeoutMs?: number) => Promise<MpvExit>;
}

interface Pending {
  /** The command's name only: a pending request must not hold the URLs it was sent with. */
  readonly command: string;
  readonly resolve: (data: JsonValue | undefined) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

const connectOnce = async (socketPath: string): Promise<Socket> => {
  const socket = createConnection(socketPath);
  await once(socket, "connect");

  return socket;
};

const connectWhenReady = async (
  socketPath: string,
  timeoutMs: number,
  hasExited: () => boolean
): Promise<Socket> => {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      // Polling: each attempt must finish before the next, and the socket may not exist yet.
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential retry of a connection
      return await connectOnce(socketPath);
    } catch (error) {
      if (hasExited()) {
        throw error;
      }

      if (Date.now() > deadline) {
        throw new Error(`mpv IPC socket ${socketPath} not ready after ${timeoutMs}ms`, {
          cause: error,
        });
      }

      // oxlint-disable-next-line eslint/no-await-in-loop -- fixed back-off between retries
      await delay(20);
    }
  }
};

interface Connection {
  readonly socket: Socket;
  readonly pid: number;
  readonly exited: Promise<MpvExit>;
  readonly cleanedUp: Promise<void>;
  readonly kill: (signal: NodeJS.Signals) => void;
  readonly requestTimeoutMs: number;
}

const subscribe = <T>(set: Set<T>, listener: T): Unsubscribe => {
  set.add(listener);

  return () => {
    set.delete(listener);
  };
};

const createClient = ({
  socket,
  pid,
  exited,
  cleanedUp,
  kill,
  requestTimeoutMs,
}: Connection): MpvClient => {
  const pending = new Map<number, Pending>();
  const eventListeners = new Set<(event: MpvEvent) => void>();
  const clientMessageListeners = new Set<(args: readonly string[]) => void>();
  const propertyHandlers = new Map<number, (data: JsonValue | undefined) => void>();
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
    if (message.kind === "reply") {
      settle(message.reply);

      return;
    }

    if (message.kind === "property-change") {
      propertyHandlers.get(message.change.id)?.(message.change.data);
    } else if (message.kind === "client-message") {
      for (const listener of clientMessageListeners) {
        listener(message.args);
      }
    }

    for (const listener of eventListeners) {
      listener(message.event);
    }
  };

  socket.setEncoding("utf-8");
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

  const command = async (...args: JsonValue[]): Promise<JsonValue | undefined> => {
    if (closed) {
      return await Promise.reject(new MpvClosedError());
    }

    const requestId = nextRequestId;
    nextRequestId += 1;
    const { promise, resolve, reject } = Promise.withResolvers<JsonValue | undefined>();

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

    return await promise;
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
      const id = nextObserveId;
      nextObserveId += 1;
      propertyHandlers.set(id, (data) => {
        if (data === undefined) {
          onChange(undefined);

          return;
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

        command("unobserve_property", id).catch(() => {
          // Best effort: mpv may already be gone.
        });
      };
    },

    onEvent: (listener) => subscribe(eventListeners, listener),

    onClientMessage: (listener) => subscribe(clientMessageListeners, listener),

    async quit(timeoutMs = 3000) {
      command("quit").catch(() => {
        // mpv may close the socket before replying to `quit`.
      });

      const timer = setTimeout(() => {
        kill("SIGKILL");
      }, timeoutMs);

      const result = await exited;
      clearTimeout(timer);
      await cleanedUp;

      return result;
    },
  };
};

export const spawnMpv = async (options: MpvSpawnOptions): Promise<MpvClient> => {
  const dir = await mkdtemp(path.join(tmpdir(), "harakiri-mpv-"));
  const socketPath = path.join(dir, "ipc.sock");

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

  const exitDeferred = Promise.withResolvers<MpvExit>();
  const spawnFailed = Promise.withResolvers<never>();
  child.once("exit", (code, signal) => {
    exit = { code, signal };
    exitDeferred.resolve(exit);
    spawnFailed.reject(new Error(`mpv exited before its IPC socket was ready (code ${code})`));
  });
  child.once("error", spawnFailed.reject);

  const { promise: exited } = exitDeferred;

  const cleanedUp = (async () => {
    await exited;
    await rm(dir, { recursive: true, force: true });
  })();

  let socket: Socket;

  try {
    socket = await Promise.race([
      connectWhenReady(socketPath, options.socketTimeoutMs ?? 5000, () => exit !== undefined),
      spawnFailed.promise,
    ]);
  } catch (error) {
    child.kill("SIGKILL");
    // A spawn error (e.g. ENOENT) never emits `exit`, so the dir cleanup above would not run.
    await rm(dir, { recursive: true, force: true });
    throw error;
  }

  spawnFailed.promise.catch(() => {
    // The race is over; a later exit must not surface as an unhandled rejection.
  });

  return createClient({
    socket,
    pid: child.pid ?? -1,
    exited,
    cleanedUp,
    kill: (signal) => {
      child.kill(signal);
    },
    requestTimeoutMs: options.requestTimeoutMs ?? 10_000,
  });
};
