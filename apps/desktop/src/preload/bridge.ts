import { DeviceId } from "@harakiri/jellyfin";
import type { IpcRenderer } from "electron";
import { z } from "zod";

import {
  channels,
  DiscoveredServer,
  LauncherAddResult,
  LauncherStatus,
  PlayerEvent,
  PlayerProbe,
  Session,
  SessionStorage,
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

type IpcArg = Parameters<IpcRenderer["send"]>[1];

export interface IpcEvent {
  readonly ports: readonly unknown[];
}

export type IpcListener = (event: IpcEvent, ...args: IpcArg[]) => void;

/** The slice of Electron's ipcRenderer the bridge uses, so tests can supply their own. */
export interface BridgeIpc {
  invoke: IpcRenderer["invoke"];
  on: (channel: string, listener: IpcListener) => void;
  removeListener: (channel: string, listener: IpcListener) => void;
}

export const createBridge = (ipc: BridgeIpc, options: BridgeOptions): HarakiriBridge => {
  const invoke = async <Schema extends z.ZodType>(
    channel: string,
    schema: Schema,
    ...args: unknown[]
  ): Promise<z.output<Schema>> => {
    let reply: unknown;

    try {
      reply = await ipc.invoke(channel, ...args);
    } catch (error) {
      // A main-process error crosses as a wrapped message: restore it, status included.
      throw fromIpc(error);
    }

    return schema.parse(reply);
  };

  return {
    deviceId: async () => await invoke(channels.deviceId, DeviceId),
    session: {
      get: async () => await invoke(channels.sessionGet, Session.nullable()),
      save: async (session) => {
        await invoke(channels.sessionSave, z.undefined(), session);
      },
      clear: async () => {
        await invoke(channels.sessionClear, z.undefined());
      },
      storage: async () => await invoke(channels.sessionStorage, SessionStorage),
    },
    app: {
      quit: async () => {
        await invoke(channels.appQuit, z.undefined());
      },
    },
    updates: {
      status: async () => await invoke(channels.updateStatus, UpdateStatus),
      restart: async () => {
        await invoke(channels.updateRestart, z.undefined());
      },
    },
    launcher: {
      status: async () => await invoke(channels.launcherStatus, LauncherStatus),
      add: async () => await invoke(channels.launcherAdd, LauncherAddResult),
    },
    discover: async () => await invoke(channels.discover, z.array(DiscoveredServer)),
    player: {
      prepare: async (request) => await invoke(channels.prepare, SignalReport, request),
      play: async (request) => {
        await invoke(channels.play, z.undefined(), request);
      },
      stop: async () => {
        await invoke(channels.stop, z.undefined());
      },
      onEvent: (listener) => {
        const handler: IpcListener = (_event, payload) => {
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
    ...(options.e2e && {
      test: { probe: async () => await invoke(channels.testProbe, PlayerProbe) },
    }),
  };
};
