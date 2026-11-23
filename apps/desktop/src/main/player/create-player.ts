import path from "node:path";

import { fidelityView } from "@harakiri/fidelity";
import type { AudioOutput, HdrSignalling } from "@harakiri/fidelity";

import type {
  PlayerEvent,
  PlayerProbe,
  PlayRequest,
  Session,
  SignalReport,
} from "../../shared/bridge";
import { clientIdentity } from "../../shared/identity";
import { signalReport, startingFidelity } from "./playback";
import type { Playback, PlaybackDeps, Prepared } from "./playback";

/** What the player needs from the app and the machine; `index.ts` passes the real ones. */
export interface PlayerWiring {
  readonly loadSession: () => Promise<Session | null>;
  /** The app's user data dir, which holds mpv's config dir. */
  readonly userData: () => string;
  /** mpv arguments appended after ours. */
  readonly extraArgs: () => string[];
  readonly audioOutput: () => Promise<AudioOutput>;
  /** How the compositor takes HDR; asked per play, after the app is ready. */
  readonly hdrSignalling: () => Promise<HdrSignalling>;
  /** The mpv executable; asked per play, so a missing build fails that play and not the app. */
  readonly mpvBinary: () => string;
  /** The environment mpv starts with; asked per play, next to `mpvBinary`. */
  readonly mpvEnv: () => Readonly<Record<string, string>>;
  readonly preparePlayback: (
    request: PlayRequest,
    deps: Pick<PlaybackDeps, "session" | "identity">
  ) => Promise<Prepared>;
  readonly startPlayback: (
    request: PlayRequest,
    send: (event: PlayerEvent) => void,
    deps: PlaybackDeps,
    prepared: Prepared | undefined
  ) => Promise<Playback>;
}

/** PlaySessionIds and transcode decisions go stale; a handoff that waited longer than this resolves again. */
const PREPARED_FOR_MS = 60_000;

/**
 * A prepared resolution belongs to one session as well as one request: it holds that session's
 * client and token, so a play after signing out or into another account must never reuse it.
 */
const requestKey = (request: PlayRequest, session: Session): string =>
  JSON.stringify([
    session.serverUrl,
    session.userId,
    session.deviceId,
    session.accessToken,
    request.itemId,
    request.mediaSourceId ?? null,
    request.startPositionTicks ?? 0,
    request.audioStreamIndex ?? null,
    request.subtitleStreamIndex ?? null,
  ]);

/** The player the main process drives over IPC: one mpv at a time, and the handoff's resolution. */
export const createPlayer = (wiring: PlayerWiring) => {
  let current: Playback | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  /** A resolution the handoff asked for, kept for the `play` that follows it. */
  let pending:
    | { readonly key: string; readonly at: number; readonly result: Promise<Prepared> }
    | undefined;

  /** Bumped by `forgetPrepared`, so a prepare that loaded the old session keeps nothing of it. */
  let sessionEpoch = 0;

  /** Runs player operations one at a time, so two plays can never race to spawn two mpvs. */
  const serialized = async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = Promise.allSettled([result]);

    return await result;
  };

  const deps = async (): Promise<
    Omit<PlaybackDeps, "audioOutput" | "hdrSignalling" | "mpvBinary" | "mpvEnv">
  > => {
    const session = await wiring.loadSession();

    if (!session) {
      throw new Error("Not signed in");
    }

    const { deviceId: _ownDeviceIdFromSession, ...identity } = clientIdentity(session.deviceId);

    return {
      session,
      identity,
      configDir: path.join(wiring.userData(), "mpv"),
      extraArgs: wiring.extraArgs(),
    };
  };

  /** Resolves PlaybackInfo for the request and keeps it for the `play` that follows. */
  const prepare = async (request: PlayRequest): Promise<SignalReport> => {
    const epoch = sessionEpoch;
    const playback = await deps();

    if (epoch !== sessionEpoch) {
      throw new Error("The session changed while preparing");
    }

    const result = wiring.preparePlayback(request, playback);
    pending = { key: requestKey(request, playback.session), at: Date.now(), result };

    const [{ resolution }, output, hdrSignalling] = await Promise.all([
      result,
      wiring.audioOutput(),
      wiring.hdrSignalling(),
    ]);

    return signalReport(
      resolution,
      fidelityView(startingFidelity(resolution, output, hdrSignalling))
    );
  };

  /** Drops any kept resolution: the session it was made with is gone (sign out, or a new sign-in). */
  const forgetPrepared = (): void => {
    sessionEpoch += 1;
    pending = undefined;
  };

  /**
   * The prepared resolution for this request and session when it is fresh and succeeded, taken at
   * most once. One made for another request is left in place: it may be newer than this play.
   */
  const takePrepared = async (
    request: PlayRequest,
    session: Session
  ): Promise<Prepared | undefined> => {
    const kept = pending;

    if (kept === undefined || kept.key !== requestKey(request, session)) {
      return undefined;
    }

    pending = undefined;

    if (Date.now() - kept.at > PREPARED_FOR_MS) {
      return undefined;
    }

    try {
      return await kept.result;
    } catch {
      return undefined;
    }
  };

  /** Forgets a playback once it has finished, unless another has replaced it meanwhile. */
  const forgetWhenDone = async (playback: Playback): Promise<void> => {
    await playback.done;

    if (current === playback) {
      current = undefined;
    }
  };

  /** Plays an item in mpv, replacing whatever is playing. Resolves once mpv has loaded the file. */
  const play = async (request: PlayRequest, send: (event: PlayerEvent) => void): Promise<void> => {
    await serialized(async () => {
      // Before the stop: a missing build fails this play and leaves the film playing alone.
      const mpvBinary = wiring.mpvBinary();
      const mpvEnv = wiring.mpvEnv();
      await current?.stop();

      const [base, audioOutput, hdrSignalling] = await Promise.all([
        deps(),
        wiring.audioOutput(),
        wiring.hdrSignalling(),
      ]);

      const playbackDeps = { ...base, audioOutput, hdrSignalling, mpvBinary, mpvEnv };
      const prepared = await takePrepared(request, playbackDeps.session);
      const playback = await wiring.startPlayback(request, send, playbackDeps, prepared);
      current = playback;
      void forgetWhenDone(playback);
    });
  };

  /** Quits mpv, reports the stop to Jellyfin, and resolves once mpv has exited. */
  const stop = async (): Promise<void> => {
    await serialized(async () => {
      await current?.stop();
    });
  };

  const probe = async (): Promise<PlayerProbe> =>
    current ? await current.probe() : { running: false };

  const isPlaying = (): boolean => current !== undefined;

  /** The live mpv pid, for the exit hook that kills mpv if Electron dies first. */
  const mpvPid = (): number | undefined => current?.pid();

  return { prepare, forgetPrepared, play, stop, probe, isPlaying, mpvPid };
};
