import { type IpcMainInvokeEvent, ipcMain } from "electron";

import { channels, NewSession, PlayRequest } from "../shared/bridge";
import { discoverServers } from "./discovery";
import { env, isE2E } from "./env";
import { forgetPrepared, play, prepare, probe, stop } from "./player/index";
import { type AppUrlCheck, fromAppOnly } from "./security";
import { clearSession, deviceId, loadSession, saveSession } from "./session";
import type { Updates } from "./updates";

/**
 * Registers every main-process handler. Only frames showing the app may call them, and payloads
 * from the renderer are untrusted and parsed here.
 */
export function registerIpc(
  isAppUrl: AppUrlCheck,
  updates: Pick<Updates, "status" | "restart">
): void {
  const handle = (
    channel: string,
    handler: (event: IpcMainInvokeEvent, payload: unknown) => unknown
  ): void => {
    ipcMain.handle(channel, fromAppOnly(isAppUrl, handler));
  };

  handle(channels.deviceId, () => deviceId());

  handle(channels.updateStatus, () => updates.status());
  handle(channels.updateRestart, () => {
    updates.restart();
  });

  handle(channels.sessionGet, () => loadSession());
  // A resolution prepared under the old session holds its token: it must not outlive it.
  handle(channels.sessionSave, (_event, payload) => {
    forgetPrepared();
    saveSession(NewSession.parse(payload));
  });
  handle(channels.sessionClear, () => {
    forgetPrepared();
    clearSession();
  });

  const discoveryAddress = env.HARAKIRI_DISCOVERY_ADDRESS;
  handle(channels.discover, () =>
    discoverServers(discoveryAddress === undefined ? {} : { address: discoveryAddress })
  );

  handle(channels.prepare, (_event, payload) => prepare(PlayRequest.parse(payload)));
  handle(channels.play, async (event, payload) => {
    const request = PlayRequest.parse(payload);
    const { sender } = event;
    // Reply to the requesting renderer: while mpv is fullscreen no Electron window has focus.
    await play(request, (playerEvent) => {
      if (!sender.isDestroyed()) {
        sender.send(channels.playerEvent, playerEvent);
      }
    });
  });
  handle(channels.stop, () => stop());

  if (isE2E) {
    handle(channels.testProbe, () => probe());
  }
}
