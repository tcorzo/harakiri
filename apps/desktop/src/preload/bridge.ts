import { DeviceId } from "@harakiri/jellyfin";
import type { IpcRenderer, IpcRendererEvent } from "electron";
import { z } from "zod";
import {
  channels,
  DiscoveredServer,
  type HarakiriBridge,
  PlayerEvent,
  PlayerProbe,
  Session,
  SignalReport,
  UpdateStatus,
} from "../shared/bridge";
import { fromIpc } from "../shared/errors";

export interface BridgeOptions {
  /** Expose `test`. Only e2e runs set it. */
  readonly e2e: boolean;
  readonly warn: (message: string, detail: string) => void;
}

export function createBridge(
  ipc: Pick<IpcRenderer, "invoke" | "on" | "removeListener">,
  options: BridgeOptions,
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
    deviceId: () => invoke(channels.deviceId, DeviceId),
    session: {
      get: () => invoke(channels.sessionGet, Session.nullable()),
      save: (session) => invoke(channels.sessionSave, z.undefined(), session),
      clear: () => invoke(channels.sessionClear, z.undefined()),
    },
    updates: {
      status: () => invoke(channels.updateStatus, UpdateStatus),
      restart: () => invoke(channels.updateRestart, z.undefined()),
    },
    discover: () => invoke(channels.discover, z.array(DiscoveredServer)),
    player: {
      prepare: (request) => invoke(channels.prepare, SignalReport, request),
      play: (request) => invoke(channels.play, z.undefined(), request),
      stop: () => invoke(channels.stop, z.undefined()),
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
    ...(options.e2e && { test: { probe: () => invoke(channels.testProbe, PlayerProbe) } }),
  };
}
