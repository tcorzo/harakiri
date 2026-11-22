// The generated Jellyfin client is typed against the DOM fetch types (its package builds with lib DOM).
/// <reference lib="dom" />
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { fidelityView, startFidelity } from "@harakiri/fidelity";
import type { AudioOutput, FidelityState, FidelityView, HdrSignalling } from "@harakiri/fidelity";
import {
  AccessToken,
  DeviceId,
  ItemId,
  joinFacts,
  MediaSourceId,
  ServerUrl,
  ServerVersion,
  UserId,
  authorizationHeader,
  playbackInfoRequest,
} from "@harakiri/jellyfin";
import type { ClientIdentity } from "@harakiri/jellyfin";
import type { BaseItemDto } from "@harakiri/jellyfin/generated";
import {
  getItem,
  getPostedPlaybackInfo,
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
} from "@harakiri/jellyfin/generated";
import { createClient } from "@harakiri/jellyfin/generated/client";
import type { Client } from "@harakiri/jellyfin/generated/client";
import { buildPlaybackArgs, setHttpHeaders, spawnMpv } from "@harakiri/mpv";
import type { AudioPassthrough, MpvClient, MpvEvent } from "@harakiri/mpv";
import { getLogger } from "@logtape/logtape";
import { match } from "ts-pattern";
import { z } from "zod";

import type {
  PlayerEvent,
  PlayerPhase,
  PlayerProbe,
  PlayRequest,
  Session,
  SignalReport,
} from "../../shared/bridge";
import { ServerStatusError } from "../../shared/errors";
import { initialControls, menuRows, parsePlayerAction, step } from "./controls";
import type { Command, ControlsInput, ControlsState } from "./controls";
import { deliveryOf, fileStreams } from "./fidelity-input";
import { watchFidelity } from "./fidelity-watch";
import type { FidelityWatch } from "./fidelity-watch";
import { inputConf } from "./input-conf";
import { OVERLAY_HEIGHT, OVERLAY_WIDTH, renderControls } from "./overlay";
import { programmeEntry, resolve } from "./resolve";
import type { ProgrammeEntry, Resolution } from "./resolve";
import { CERTIFICATE_NOT_TRUSTED, isCertificateRejection } from "./tls";

const logger = getLogger(["harakiri", "player"]);

const HIDE_AFTER_MS = 4000;
const EVENT_EVERY_MS = 1000;
const PROGRESS_EVERY_MS = 10_000;
const OVERLAY_ID = 1;

const TICKS_PER_SECOND = 10_000_000;
const toTicks = (seconds: number) => Math.max(0, Math.round(seconds * TICKS_PER_SECOND));

// A failed report must never interrupt playback.
const report = async <T>(what: string, call: () => Promise<T>): Promise<void> => {
  try {
    await call();
  } catch (error) {
    logger.warn("Reporting {what} to Jellyfin failed: {error}", { what, error });
  }
};

const mpvTrackId = z.union([z.number(), z.literal(false)]);

export interface PlaybackDeps {
  readonly session: Session;
  readonly identity: Omit<ClientIdentity, "deviceId">;
  /** The app-owned mpv config dir; its input.conf is rewritten on every start. */
  readonly configDir: string;
  /** Appended last, so they override ours (e2e runs mpv headless with `--vo=null`). */
  readonly extraArgs: readonly string[];
  /** The output mpv plays to, which decides what it may bitstream. */
  readonly audioOutput: AudioOutput;
  /** How the compositor takes HDR, which decides mpv's colorspace hint. */
  readonly hdrSignalling: HdrSignalling;
  /** The mpv executable: harakiri's build, or HARAKIRI_MPV. */
  readonly mpvBinary: string;
  /** How long an IPC request waits for mpv's answer before mpv counts as dead; the client's 10 s when unset. */
  readonly requestTimeoutMs?: number;
}

export interface Playback {
  /** Settles once playback has finished and mpv has exited. */
  readonly done: Promise<void>;
  stop: () => Promise<void>;
  probe: () => Promise<PlayerProbe>;
  /** The mpv pid while it runs, undefined once it has exited, so a reused pid is never killed. */
  pid: () => number | undefined;
}

interface Finish {
  readonly phase: Extract<PlayerPhase, "ended" | "stopped" | "error">;
  readonly error?: string;
}

const endFile = z.object({ reason: z.string(), file_error: z.string().optional() });

const logMessage = z.object({
  event: z.literal("log-message"),
  prefix: z.string(),
  level: z.string(),
  text: z.string(),
});

const trackArg = (name: "aid" | "sid", id: number | false | undefined): string[] =>
  id === undefined ? [] : [`--${name}=${id === false ? "no" : id}`];

// argv is world-readable through /proc: the token and the `ApiKey=` sidecar URLs go over IPC.
const mpvArgs = (
  resolution: Resolution,
  title: string,
  request: PlayRequest,
  deps: PlaybackDeps,
  fidelity: FidelityView
) => [
  ...buildPlaybackArgs({
    audioPassthrough: passthroughOf(fidelity),
    colorspaceHint: fidelity.colorspaceHint,
  }),
  // Verbose, so the run log shows which audio and video outputs mpv opened and why one failed.
  "--msg-level=all=v",
  "--no-osc",
  "--input-default-bindings=no",
  "--input-builtin-bindings=no",
  "--osd-level=0",
  `--start=${(request.startPositionTicks ?? 0) / TICKS_PER_SECOND}`,
  ...trackArg("aid", resolution.aid),
  ...trackArg("sid", resolution.sid),
  `--force-media-title=${title}`,
  ...deps.extraArgs,
];

const jellyfinClient = (session: Session, auth: string): Client => {
  const client = createClient({
    baseUrl: session.serverUrl.replace(/\/+$/u, ""),
    auth: () => auth,
  });

  // ky 2 consumes an error response's body before the generated client reads it, which loses the
  // status behind "body already used". The status crosses IPC, so a 401 reads as signed out.
  client.interceptors.response.use((response) => {
    if (!response.ok) {
      throw new ServerStatusError(response.status, response.url);
    }

    return response;
  });

  return client;
};

/** A play request resolved against the server: what to play, and what the server decided. */
export interface Prepared {
  readonly client: Client;
  readonly auth: string;
  readonly resolution: Resolution;
  /** The overlay's title, fetched beside PlaybackInfo; never rejects, falling back to the source name. */
  readonly entry: Promise<ProgrammeEntry>;
}

/** The item fetch only names the overlay; one slower than this must not hold mpv back. */
const ENTRY_TIMEOUT_MS = 3000;

/** Where fidelity starts for a resolution: the file, how the server sends it, and the output. */
export const startingFidelity = (
  resolution: Resolution,
  output: AudioOutput,
  hdrSignalling: HdrSignalling
): FidelityState => {
  const file = fileStreams(resolution.source, resolution.audioStreamIndex);

  return startFidelity({ ...file, delivery: deliveryOf(resolution, file), output, hdrSignalling });
};

/** What the handoff states: how the file will play, every downgrade, and the server's reasons. */
export const signalReport = (resolution: Resolution, view: FidelityView): SignalReport => ({
  facts: [...view.facts],
  downgrades: [...view.downgrades],
  transcodeReasons: [...resolution.transcodeReasons],
  unreadable: resolution.unreadable,
});

const hasPicture = (state: FidelityState): boolean =>
  (state.delivery.kind === "direct" ? state.picture : state.delivery.picture) !== null;

const passthroughOf = (view: FidelityView): AudioPassthrough => {
  const [first, ...rest] = view.bitstream;

  return first === undefined ? "none" : [first, ...rest];
};

/** The overlay's entry for the fetched item; a failed fetch logs and yields null, never a rejection. */
const entryOf = async (
  item: Promise<{ readonly data: BaseItemDto }>,
  itemId: ItemId
): Promise<ProgrammeEntry | null> => {
  let data: BaseItemDto;

  try {
    ({ data } = await item);
  } catch (error) {
    logger.warn("Fetching the title of {itemId} failed: {error}", { itemId, error });

    return null;
  }

  return programmeEntry(data);
};

/**
 * Asks the server how it will send the item (PlaybackInfo), and resolves as soon as it answers so
 * the handoff can state the decision. The programme entry is fetched alongside, and a slow or
 * failed fetch only costs the overlay its title.
 */
export const preparePlayback = async (
  request: PlayRequest,
  deps: Pick<PlaybackDeps, "session" | "identity">
): Promise<Prepared> => {
  const { session } = deps;
  const itemId = ItemId.parse(request.itemId);

  const auth = authorizationHeader(
    { ...deps.identity, deviceId: DeviceId.parse(session.deviceId) },
    AccessToken.parse(session.accessToken)
  );

  const client = jellyfinClient(session, auth);
  const userId = UserId.parse(session.userId);

  const item = getItem({
    client,
    throwOnError: true,
    path: { itemId },
    query: { userId },
    signal: AbortSignal.timeout(ENTRY_TIMEOUT_MS),
  });

  // Handled now, so a failure that lands while PlaybackInfo is still pending is never unhandled.
  const fetched = entryOf(item, itemId);

  const info = await getPostedPlaybackInfo({
    client,
    throwOnError: true,
    path: { itemId },
    body: playbackInfoRequest({
      userId,
      server: ServerVersion.parse(session.serverVersion),
      source:
        request.mediaSourceId === undefined
          ? { kind: "default" }
          : {
              kind: "chosen",
              mediaSourceId: MediaSourceId.parse(request.mediaSourceId),
              audioStreamIndex: request.audioStreamIndex,
            },
      startTimeTicks: request.startPositionTicks ?? 0,
    }),
  });

  const resolution = resolve(info.data, request, ServerUrl.parse(session.serverUrl));

  return {
    client,
    auth,
    resolution,
    entry: fetched.then(
      (entry) => entry ?? programmeEntry({ Name: resolution.source.Name ?? null, Type: "Movie" })
    ),
  };
};

/**
 * Starts mpv on the item and runs it until it ends, fails, or is stopped. Reuses `prepared` when
 * the handoff already resolved the request, otherwise resolves it first.
 * Resolves once mpv has loaded the file; rejects (after an `error` event) if it never does.
 */
export const startPlayback = async (
  request: PlayRequest,
  send: (event: PlayerEvent) => void,
  deps: PlaybackDeps,
  prepared?: Prepared
): Promise<Playback> => {
  const itemId = ItemId.parse(request.itemId);
  const startTicks = request.startPositionTicks ?? 0;

  let base: Omit<PlayerEvent, "phase" | "positionTicks"> = {
    itemId,
    facts: [],
    downgrades: [],
    transcodeReasons: [],
    unreadable: false,
  };

  let mpv: MpvClient | undefined;

  try {
    const ready = prepared ?? (await preparePlayback(request, deps));
    const { client, auth, resolution } = ready;
    const fidelity = startingFidelity(resolution, deps.audioOutput, deps.hdrSignalling);
    const signal = signalReport(resolution, fidelityView(fidelity));

    base =
      resolution.durationTicks === undefined
        ? { itemId, ...signal }
        : { itemId, ...signal, durationTicks: resolution.durationTicks };
    send({ ...base, phase: "starting", positionTicks: startTicks });
    const entry = await ready.entry;

    await mkdir(deps.configDir, { recursive: true });
    await writeFile(path.join(deps.configDir, "input.conf"), inputConf());
    logger.info("Starting mpv {binary}", { binary: deps.mpvBinary });
    mpv = await spawnMpv({
      binary: deps.mpvBinary,
      requestTimeoutMs: deps.requestTimeoutMs,
      config: { dir: deps.configDir },
      args: mpvArgs(resolution, entry.title, request, deps, fidelityView(fidelity)),
    });
    await setHttpHeaders(mpv, { Authorization: auth });

    return await run(mpv, { client, resolution, entry, base, send, startTicks, fidelity });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Playback of {itemId} failed to start: {message}", { itemId, message });

    if (mpv) {
      await mpv.quit();
    }

    send({ ...base, phase: "error", positionTicks: startTicks, error: message });
    throw error;
  }
};

/**
 * Sidecars are added after the file loads, in `subtitleFiles` order, so mpv numbers them after
 * the embedded subtitles exactly as the track table expects. A sidecar `sid` could not be
 * selected before its track existed, so it is applied again once they are all in.
 */
const addSidecarSubtitles = async (mpv: MpvClient, resolution: Resolution): Promise<void> => {
  const files = resolution.tracks.subtitleFiles;

  if (files.length === 0) {
    return;
  }

  for (const [index, url] of files.entries()) {
    try {
      // Without a title mpv names the track after its URL, which puts the ApiKey in track-list.
      // oxlint-disable-next-line eslint/no-await-in-loop -- mpv numbers sidecars in the order they are added, which the track table relies on
      await mpv.command("sub-add", url, "auto", `External ${index + 1}`);
    } catch (error) {
      // A missing sidecar must not stop playback, but the ids after it would shift. mpv's errors
      // name the command only, so the URL and its ApiKey never reach the log.
      logger.warn("mpv could not load a sidecar subtitle: {error}", { error });
    }
  }

  if (resolution.sid === undefined) {
    return;
  }

  // If mpv died meanwhile, its exit already ends playback with an error.
  try {
    await mpv.setProperty("sid", resolution.sid === false ? "no" : resolution.sid);
  } catch (error) {
    logger.warn("mpv could not select the subtitle: {error}", { error });
  }
};

interface RunContext {
  readonly client: Client;
  readonly resolution: Resolution;
  readonly entry: { readonly title: string; readonly programme: string };
  readonly base: Omit<PlayerEvent, "phase" | "positionTicks">;
  readonly send: (event: PlayerEvent) => void;
  readonly startTicks: number;
  readonly fidelity: FidelityState;
}

const run = async (mpv: MpvClient, context: RunContext): Promise<Playback> => {
  const { client, resolution, entry, base, send } = context;
  const rows = menuRows(resolution.tracks);
  let controls: ControlsState = { ...initialControls, aid: resolution.aid, sid: resolution.sid };
  let position = context.startTicks / TICKS_PER_SECOND;

  let duration =
    resolution.durationTicks === undefined
      ? undefined
      : resolution.durationTicks / TICKS_PER_SECOND;

  let started = false;
  let finished: Promise<void> | undefined;
  let lastOverlay: string | undefined;
  let hideTimer: NodeJS.Timeout | undefined;
  const timers: NodeJS.Timeout[] = [];

  const progressBody = () => ({
    ItemId: base.itemId,
    MediaSourceId: resolution.mediaSourceId,
    PlaySessionId: resolution.playSessionId ?? null,
    PlayMethod: resolution.method,
    PositionTicks: toTicks(position),
    IsPaused: controls.paused,
    CanSeek: true,
    AudioStreamIndex: resolution.audioStreamIndex ?? null,
    SubtitleStreamIndex: resolution.subtitleStreamIndex ?? null,
  });

  const reportProgress = () => {
    if (started) {
      void report(
        "progress",
        async () =>
          await reportPlaybackProgress({ client, throwOnError: true, body: progressBody() })
      );
    }
  };

  // oxlint-disable-next-line eslint/prefer-const -- the closures below read it before the watcher exists; it is assigned once mpv's properties are observed
  let watch: FidelityWatch | undefined;
  const fidelityNow = () => watch?.view() ?? fidelityView(context.fidelity);

  const signalNow = () => {
    const view = fidelityNow();

    return { facts: [...view.facts], downgrades: [...view.downgrades] };
  };

  // A new audio track may bitstream where the last could not, or the reverse, so mpv is told
  // what it may bitstream for it before it opens the track. A transcode plays the server's sound.
  const beforeAudioTrack = async (id: number | false) => {
    if (watch === undefined || resolution.method === "Transcode") {
      return;
    }

    const index = resolution.tracks.audio.find((track) => track.mpvId === id)?.index;
    const sound = id === false ? null : fileStreams(resolution.source, index).sound;
    await watch.selectSound(sound);
  };

  const emit = () => {
    if (finished) {
      return;
    }

    send({
      ...base,
      ...signalNow(),
      phase: controls.paused ? "paused" : "playing",
      positionTicks: toTicks(position),
    });
  };

  const drawOverlay = async (args: (string | number | boolean)[]) => {
    try {
      await mpv.command(...args);
    } catch {
      // An overlay mpv cannot draw is never worth interrupting playback for.
    }
  };

  const overlay = (ass: string | undefined) => {
    const key = ass ?? "";

    if (key === lastOverlay) {
      return;
    }

    lastOverlay = key;

    const args =
      ass === undefined
        ? ["osd-overlay", OVERLAY_ID, "none", "", 0, 0, 0, false, false]
        : [
            "osd-overlay",
            OVERLAY_ID,
            "ass-events",
            ass,
            OVERLAY_WIDTH,
            OVERLAY_HEIGHT,
            0,
            false,
            false,
          ];

    void drawOverlay(args);
  };

  const render = () => {
    const fidelity = fidelityNow();
    overlay(
      controls.visible
        ? renderControls({
            ...entry,
            signalPath: joinFacts(fidelity.facts),
            downgraded: fidelity.downgrades.length > 0,
            // A file the server could not read is not a choice to convert it; say what happened.
            transcodeReasons: resolution.unreadable
              ? ["The server could not read this file"]
              : resolution.transcodeReasons,
            positionSeconds: position,
            durationSeconds: duration,
            paused: controls.paused,
            menu: controls.menu && {
              rows,
              cursor: controls.menu.cursor,
              aid: controls.aid,
              sid: controls.sid,
            },
          })
        : undefined
    );
  };

  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      dispatch({ type: "hide" });
    }, HIDE_AFTER_MS);
  };

  const execute = async (command: Command) =>
    await match(command)
      .with({ type: "pause" }, async ({ paused }) => {
        await mpv.setProperty("pause", paused);
      })
      .with({ type: "seek" }, async ({ seconds }) => await mpv.command("seek", seconds, "relative"))
      .with({ type: "track" }, async ({ property, id }) => {
        if (property === "aid") {
          await beforeAudioTrack(id);
        }

        await mpv.setProperty(property, id === false ? "no" : id);
      })
      .with({ type: "stop" }, async () => {
        await finish({ phase: "stopped" });
      })
      .exhaustive();

  const executeOrWarn = async (command: Command) => {
    try {
      await execute(command);
    } catch (error) {
      logger.warn("mpv command {command} failed: {error}", { command, error });
    }
  };

  const dispatch = (input: ControlsInput) => {
    if (finished) {
      return;
    }

    const next = step(controls, input, rows);
    controls = next.state;

    for (const command of next.commands) {
      void executeOrWarn(command);
    }

    if (input.type === "action") {
      scheduleHide();
    }

    render();
  };

  const finish = async (outcome: Finish): Promise<void> => {
    finished ??= (async () => {
      clearTimeout(hideTimer);

      for (const timer of timers) {
        clearInterval(timer);
      }

      watch?.stop();

      // At eof mpv has already unloaded the file, and the last time-pos notification can lag
      // the real end (it did by 5 s when ao_pcm decoded faster than real time).
      const positionTicks = toTicks(
        outcome.phase === "ended" && duration !== undefined ? duration : position
      );

      const reported = started
        ? report(
            "stop",
            async () =>
              await reportPlaybackStopped({
                client,
                throwOnError: true,
                body: {
                  ItemId: base.itemId,
                  MediaSourceId: resolution.mediaSourceId,
                  PlaySessionId: resolution.playSessionId ?? null,
                  PositionTicks: positionTicks,
                  Failed: outcome.phase === "error",
                },
              })
          )
        : undefined;

      await mpv.quit();
      // The renderer takes the screen back as soon as mpv is gone; the stop report can lag the
      // server by seconds and must not hold the owner on a dark screen with a dead gamepad.
      send({ ...base, ...signalNow(), ...outcome, positionTicks });
      await reported;
      // Only now does the server hold the final resume point, so only now may screens refetch it.
      send({ ...base, ...signalNow(), phase: "reported", positionTicks });
    })();

    await finished;
  };

  const {
    promise: loaded,
    resolve: resolveLoaded,
    reject: rejectLoaded,
  } = Promise.withResolvers<MpvEvent>();

  // Before the file loads, startPlayback owns the failure and its error event.
  const fail = (error: string) => {
    if (started) {
      void finish({ phase: "error", error });
    } else {
      rejectLoaded(new Error(error));
    }
  };

  // mpv logs why libcurl refused the server's certificate just before the file fails to load.
  let certificateRejected = false;

  const failOnExit = async () => {
    const exit = await mpv.exited;
    fail(`mpv exited unexpectedly (code ${exit.code ?? exit.signal})`);
  };

  mpv.onEvent((event: MpvEvent) => {
    if (event.event === "file-loaded") {
      resolveLoaded(event);
    }

    if (event.event === "playback-restart" && started) {
      reportProgress();
    }

    if (event.event !== "end-file") {
      return;
    }

    const end = endFile.safeParse(event);

    if (!end.success) {
      return;
    }

    const { reason, file_error: fileError } = end.data;

    if (reason === "eof") {
      void finish({ phase: "ended" });
    }

    if (reason === "error") {
      fail(
        certificateRejected
          ? CERTIFICATE_NOT_TRUSTED
          : `mpv could not play the file: ${fileError ?? "unknown error"}`
      );
    }
  });
  void failOnExit();

  // Handled now: a failure before `await loaded` below must not count as an unhandled rejection.
  void Promise.allSettled([loaded]);

  mpv.onClientMessage(([target, raw]) => {
    if (target !== "harakiri") {
      return;
    }

    const action = parsePlayerAction(raw);

    if (action) {
      dispatch({ type: "action", action });
    }
  });
  await Promise.all([
    mpv.observeProperty("time-pos", z.number(), (value) => {
      if (value !== undefined) {
        position = value;
      }
    }),
    mpv.observeProperty("duration", z.number(), (value) => {
      if (value !== undefined) {
        duration = value;
      }
    }),
    mpv.observeProperty("pause", z.boolean(), (value) => {
      if (value === undefined || value === controls.paused) {
        return;
      }

      dispatch({ type: "paused", paused: value });
      reportProgress();
      emit();
    }),
    mpv.observeProperty("aid", mpvTrackId, (aid) => {
      dispatch({ type: "tracks", aid, sid: controls.sid });
    }),
    mpv.observeProperty("sid", mpvTrackId, (sid) => {
      dispatch({ type: "tracks", aid: controls.aid, sid });
    }),
  ]);

  watch = watchFidelity(mpv, context.fidelity, {
    aid: () => controls.aid,
    paused: () => controls.paused,
    video: hasPicture(context.fidelity),
    startSeconds: context.startTicks / TICKS_PER_SECOND,
    onChange: () => {
      emit();
      render();
    },
  });
  // Subscribed before the file loads: a renderer that cannot start fails during the load.
  mpv.onEvent((event) => {
    const log = logMessage.safeParse(event);

    if (!log.success) {
      return;
    }

    if (isCertificateRejection(log.data)) {
      certificateRejected = true;
    }

    if (log.data.prefix.startsWith("ao")) {
      watch?.audioOutputWarning();
    }

    if (log.data.prefix.startsWith("vo") && log.data.level !== "warn") {
      watch?.rendererError();
    }
  });
  await mpv.command("request_log_messages", "warn");
  await mpv.command("loadfile", resolution.url);
  await loaded;
  started = true;
  watch.start();

  await addSidecarSubtitles(mpv, resolution);

  if (!finished) {
    await report(
      "start",
      async () => await reportPlaybackStart({ client, throwOnError: true, body: progressBody() })
    );
  }

  emit();
  scheduleHide();
  render();
  timers.push(
    setInterval(() => {
      emit();

      if (controls.visible) {
        render();
      }
    }, EVENT_EVERY_MS),
    setInterval(reportProgress, PROGRESS_EVERY_MS)
  );

  const read = async <T>(name: string, schema: z.ZodType<T>): Promise<T | undefined> => {
    try {
      return await mpv.getProperty(name, schema);
    } catch {
      return undefined;
    }
  };

  let mpvAlive = true;

  const markExited = async () => {
    await mpv.exited;
    mpvAlive = false;
  };

  void markExited();

  const untilDone = async (): Promise<void> => {
    await mpv.exited;
    await finished;
  };

  return {
    done: untilDone(),
    pid: () => (mpvAlive ? mpv.pid : undefined),
    stop: async () => {
      await finish({ phase: "stopped" });
    },
    probe: async () => {
      if (finished) {
        return { running: false };
      }

      const [
        filePath,
        timePos,
        pause,
        aid,
        sid,
        audioCodec,
        audioFormat,
        videoGamma,
        videoPrimaries,
      ] = await Promise.all([
        read("path", z.string()),
        read("time-pos", z.number()),
        read("pause", z.boolean()),
        read("aid", mpvTrackId),
        read("sid", mpvTrackId),
        read("audio-codec-name", z.string()),
        read("audio-params/format", z.string()),
        read("video-params/gamma", z.string()),
        read("video-params/primaries", z.string()),
      ]);

      return {
        running: true,
        path: filePath,
        timePos,
        pause,
        aid,
        sid,
        audioCodec,
        audioSpdif: audioFormat === undefined ? undefined : audioFormat.startsWith("spdif"),
        videoGamma,
        videoPrimaries,
        osdVisible: controls.visible,
      };
    },
  };
};
