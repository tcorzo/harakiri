import { ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import type { z } from "zod";

import { channels, NewSession, PlayRequest } from "../shared/bridge";
import { discoverServers } from "./discovery";
import { env, isE2E } from "./env";
import { forgetPrepared, play, prepare, probe, stop } from "./player/index";
import { fromAppOnly } from "./security";
import type { AppUrlCheck } from "./security";
import { clearSession, deviceId, loadSession, saveSession, sessionStorage } from "./session";
import type { Updates } from "./updates";

type HandlerResult = ReturnType<Parameters<typeof ipcMain.handle>[1]>;

/**
 * Registers every main-process handler. Only frames showing the app may call them, and payloads
 * from the renderer are untrusted and parsed here.
 */
export const registerIpc = (
  isAppUrl: AppUrlCheck,
  updates: Pick<Updates, "status" | "restart">
): void => {
  const handle = (channel: string, handler: (event: IpcMainInvokeEvent) => HandlerResult): void => {
    ipcMain.handle(channel, fromAppOnly(isAppUrl, handler));
  };

  const handleParsed = <Payload>(
    channel: string,
    schema: z.ZodType<Payload>,
    handler: (event: IpcMainInvokeEvent, payload: Payload) => HandlerResult
  ): void => {
    const listener: Parameters<typeof ipcMain.handle>[1] = fromAppOnly(isAppUrl, (event, payload) =>
      // oxlint-disable-next-line typescript/no-unsafe-return -- ipcMain.handle's listener is typed to return any
      handler(event, schema.parse(payload))
    );

    ipcMain.handle(channel, listener);
  };

  handle(channels.deviceId, () => deviceId());

  handle(channels.updateStatus, () => updates.status());
  handle(channels.updateRestart, () => {
    updates.restart();
  });

  handle(channels.sessionGet, async () => await loadSession());
  // A resolution prepared under the old session holds its token: it must not outlive it.
  handleParsed(channels.sessionSave, NewSession, async (_event, session) => {
    forgetPrepared();
    await saveSession(session);
  });
  handle(channels.sessionClear, () => {
    forgetPrepared();
    clearSession();
  });
  handle(channels.sessionStorage, async () => await sessionStorage());

  const discoveryAddress = env.HARAKIRI_DISCOVERY_ADDRESS;
  handle(
    channels.discover,
    async () =>
      await discoverServers(discoveryAddress === undefined ? {} : { address: discoveryAddress })
  );

  handleParsed(channels.prepare, PlayRequest, async (_event, request) => await prepare(request));
  handleParsed(channels.play, PlayRequest, async (event, request) => {
    const { sender } = event;
    // Reply to the requesting renderer: while mpv is fullscreen no Electron window has focus.
    await play(request, (playerEvent) => {
      if (!sender.isDestroyed()) {
        sender.send(channels.playerEvent, playerEvent);
      }
    });
  });
  handle(channels.stop, async () => {
    await stop();
  });

  if (isE2E) {
    handle(channels.testProbe, async () => await probe());
  }
};
