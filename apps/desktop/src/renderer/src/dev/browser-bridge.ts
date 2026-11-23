import { DeviceId } from "@harakiri/jellyfin";

import { Session } from "../../../shared/bridge";
import type { HarakiriBridge, NewSession } from "../../../shared/bridge";

const sessionKey = "harakiri.dev.session";
const deviceKey = "harakiri.dev.deviceId";

const needsElectron = (): Error =>
  new Error("Playback needs the Electron app (mpv); a browser can only browse.");

const readDeviceId = (): DeviceId => {
  const stored = localStorage.getItem(deviceKey);

  if (stored !== null) {
    return DeviceId.parse(stored);
  }

  const created = DeviceId.parse(crypto.randomUUID());
  localStorage.setItem(deviceKey, created);

  return created;
};

/** localStorage is a boundary: anything another version or the owner left there is parsed, never trusted. */
const readSession = (): Session | null => {
  const raw = localStorage.getItem(sessionKey);

  if (raw === null) {
    return null;
  }

  try {
    const parsed = Session.safeParse(JSON.parse(raw));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** The preload bridge for a plain browser tab on the dev server: the session lives in localStorage and nothing plays. */
export const browserBridge: HarakiriBridge = {
  deviceId: async () => await Promise.resolve(readDeviceId()),
  session: {
    get: async () => await Promise.resolve(readSession()),
    save: async (session: NewSession) => {
      const deviceId = readDeviceId();
      localStorage.setItem(sessionKey, JSON.stringify({ ...session, deviceId }));
      await Promise.resolve();
    },
    clear: async () => {
      localStorage.removeItem(sessionKey);
      await Promise.resolve();
    },
    storage: async () => await Promise.resolve("file" as const),
  },
  discover: async () => await Promise.resolve([]),
  updates: {
    status: async () => await Promise.resolve({ state: "unsupported" }),
    restart: async () => {
      await Promise.resolve();
    },
  },
  launcher: {
    status: async () => await Promise.resolve({ state: "unavailable" }),
    add: async () =>
      await Promise.resolve({ state: "failed", reason: "There is no launcher in a browser." }),
  },
  player: {
    prepare: async () => await Promise.reject(needsElectron()),
    play: async () => {
      await Promise.reject(needsElectron());
    },
    stop: async () => {
      await Promise.resolve();
    },
    onEvent: () => () => {
      // nothing to unsubscribe from
    },
  },
};

export const installBrowserBridge = (): void => {
  Object.defineProperty(window, "harakiri", { configurable: true, value: browserBridge });
};
