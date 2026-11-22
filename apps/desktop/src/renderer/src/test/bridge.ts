import type { HarakiriBridge } from "../../../shared/bridge";

const missing = (name: string): Error =>
  new Error(`window.harakiri.${name} is not stubbed in this test: install one with installBridge`);

/** A bridge method a test did not stub: its promise rejects, naming it. */
const unstubbed = (name: string) => async (): Promise<never> => await Promise.reject(missing(name));

/** The preload bridge with nothing behind it: any call fails naming the method a test must stub. */
export const unstubbedBridge: HarakiriBridge = {
  deviceId: unstubbed("deviceId"),
  session: {
    get: unstubbed("session.get"),
    save: unstubbed("session.save"),
    clear: unstubbed("session.clear"),
    storage: unstubbed("session.storage"),
  },
  discover: unstubbed("discover"),
  updates: {
    status: unstubbed("updates.status"),
    restart: unstubbed("updates.restart"),
  },
  launcher: {
    status: unstubbed("launcher.status"),
    add: unstubbed("launcher.add"),
  },
  player: {
    prepare: unstubbed("player.prepare"),
    play: unstubbed("player.play"),
    stop: unstubbed("player.stop"),
    onEvent: () => {
      throw missing("player.onEvent");
    },
  },
};

/**
 * Stands in for the preload's `window.harakiri`, which component tests run without: Electron is
 * not there. It takes a whole bridge, so a test spreads `unstubbedBridge` and overrides the parts
 * it needs: `{ ...unstubbedBridge, session: { ...unstubbedBridge.session, get } }`.
 */
export const installBridge = (bridge: HarakiriBridge = unstubbedBridge): void => {
  Object.defineProperty(window, "harakiri", { configurable: true, value: bridge });
};
