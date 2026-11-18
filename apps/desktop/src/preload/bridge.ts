import { DeviceId } from "@harakiri/jellyfin";
import type { IpcRenderer, IpcRendererEvent } from "electron";
import { z } from "zod";

import {
  channels,
  DiscoveredServer,
  PlayerEvent,
  PlayerProbe,
  Session,
  SignalReport,
  UpdateStatus,
} from "../shared/bridge";
import type { HarakiriBridge } from "../shared/bridge";
import { fromIpc } from "../shared/errors";

export interface BridgeOptions {
  /** Expose `test`. Only e2e runs set it. */
  readonly e2e: boolean;
  readonly warn: (message: string, detail: string) => void;
}

export function createBridge(
  ipc: Pick<IpcRenderer, "invoke" | "on" | "removeListener">,
  options: BridgeOptions
): HarakiriBridge {
  async function invoke<T>(
    channel: string,
    schema: { parse(data: unknown): T },
    ...args: unknown[]
  ): Promise<T> {
    let reply: unknown;

    try {
      reply = await ipc.invoke(channel, ...args);
    } catch (error) {
      // A main-process error crosses as a wrapped message: restore it, status included.
      throw fromIpc(error);
    }

    return schema.parse(reply);
  }

  return {
    deviceId: async () => invoke(channels.deviceId, DeviceId),
    session: {
      get: async () => invoke(channels.sessionGet, Session.nullable()),
      save: async (session) => invoke(channels.sessionSave, z.undefined(), session),
      clear: async () => invoke(channels.sessionClear, z.undefined()),
    },
    updates: {
      status: async () => invoke(channels.updateStatus, UpdateStatus),
      restart: async () => invoke(channels.updateRestart, z.undefined()),
    },
    discover: async () => invoke(channels.discover, z.array(DiscoveredServer)),
    player: {
      prepare: async (request) => invoke(channels.prepare, SignalReport, request),
      play: async (request) => invoke(channels.play, z.undefined(), request),
      stop: async () => invoke(channels.stop, z.undefined()),
      onEvent: (listener) => {
        const handler = (_event: IpcRendererEvent, payload: unknown): void => {
          const parsed = PlayerEvent.safeParse(payload);

          if (parsed.success) {
            listener(parsed.data);
          } else {
            options.warn("Dropped a malformed player event", z.prettifyError(parsed.error));
          }
        };

        ipc.on(channels.playerEvent, handler);

        return () => {
          ipc.removeListener(channels.playerEvent, handler);
        };
      },
    },
    ...(options.e2e && { test: { probe: async () => invoke(channels.testProbe, PlayerProbe) } }),
  };
}
