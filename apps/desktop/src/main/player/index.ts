import { join } from "node:path";
import { fidelityView } from "@harakiri/fidelity";
import { app } from "electron";
import type {
  PlayerEvent,
  PlayerProbe,
  PlayRequest,
  Session,
  SignalReport,
} from "../../shared/bridge";
import { clientIdentity } from "../../shared/identity";
import { isE2E } from "../env";
import { loadSession } from "../session";
import { AudioOutputJson, readAudioOutput } from "./audio-output";
import {
  type Playback,
  type PlaybackDeps,
  type Prepared,
  preparePlayback,
  signalReport,
  startingFidelity,
  startPlayback,
} from "./playback";

let current: Playback | undefined;
let queue: Promise<unknown> = Promise.resolve();

/** A resolution the handoff asked for, kept for the `play` that follows it. */
let pending:
  | { readonly key: string; readonly at: number; readonly result: Promise<Prepared> }
  | undefined;

/** PlaySessionIds and transcode decisions go stale; a handoff that waited longer than this resolves again. */
const PREPARED_FOR_MS = 60_000;

/** Runs player operations one at a time, so two plays can never race to spawn two mpvs. */
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.catch(() => {});
  return result;
}

// Whitespace-split only: e2e passes plain flags such as `--vo=null --ao=pcm --ao-pcm-file=/tmp/x`.
const e2eMpvArgs = (): string[] =>
  isE2E ? (process.env["HARAKIRI_MPV_ARGS"] ?? "").split(/\s+/).filter(Boolean) : [];

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

// e2e describes the output instead of probing the workstation's, e.g. a receiver for passthrough.
const audioOutput = () => {
  const given = isE2E ? process.env["HARAKIRI_AUDIO_OUTPUT"] : undefined;
  return given === undefined
    ? readAudioOutput()
    : Promise.resolve(AudioOutputJson.parse(JSON.parse(given)));
};

function deps(): Omit<PlaybackDeps, "audioOutput"> {
  const session = loadSession();
  if (!session) throw new Error("Not signed in");
  const { deviceId: _ownDeviceIdFromSession, ...identity } = clientIdentity(session.deviceId);
  return {
    session,
    identity,
    configDir: join(app.getPath("userData"), "mpv"),
    extraArgs: e2eMpvArgs(),
  };
}

/** Resolves PlaybackInfo for the request and keeps it for the `play` that follows. */
export async function prepare(request: PlayRequest): Promise<SignalReport> {
  const playback = deps();
  const result = preparePlayback(request, playback);
  pending = { key: requestKey(request, playback.session), at: Date.now(), result };
  const [{ resolution }, output] = await Promise.all([result, audioOutput()]);
  return signalReport(resolution, fidelityView(startingFidelity(resolution, output)));
}

/** Drops any kept resolution: the session it was made with is gone (sign out, or a new sign-in). */
export function forgetPrepared(): void {
  pending = undefined;
}

/**
 * The prepared resolution for this request and session when it is fresh and succeeded, taken at
 * most once. One made for another request is left in place: it may be newer than this play.
 */
async function takePrepared(request: PlayRequest, session: Session): Promise<Prepared | undefined> {
  const kept = pending;
  if (kept === undefined || kept.key !== requestKey(request, session)) return undefined;
  pending = undefined;
  if (Date.now() - kept.at > PREPARED_FOR_MS) return undefined;
  return kept.result.catch(() => undefined);
}

/** Plays an item in mpv, replacing whatever is playing. Resolves once mpv has loaded the file. */
export function play(request: PlayRequest, send: (event: PlayerEvent) => void): Promise<void> {
  return serialized(async () => {
    await current?.stop();
    const playbackDeps = { ...deps(), audioOutput: await audioOutput() };
    const prepared = await takePrepared(request, playbackDeps.session);
    const playback = await startPlayback(request, send, playbackDeps, prepared);
    current = playback;
    void playback.done.then(() => {
      if (current === playback) current = undefined;
    });
  });
}

/** Quits mpv, reports the stop to Jellyfin, and resolves once mpv has exited. */
export function stop(): Promise<void> {
  return serialized(async () => {
    await current?.stop();
  });
}

export async function probe(): Promise<PlayerProbe> {
  return current ? current.probe() : { running: false };
}

/** The live mpv pid, for the exit hook that kills mpv if Electron dies first. */
export const isPlaying = (): boolean => current !== undefined;

export const mpvPid = (): number | undefined => current?.pid();
