import { fidelityView, observe } from "@harakiri/fidelity";
import type {
  Action,
  FidelityState,
  FidelityView,
  Observation,
  Renderer,
  SoundSource,
} from "@harakiri/fidelity";
import { getLogger } from "@logtape/logtape";
import { match } from "ts-pattern";
import { z } from "zod";

const logger = getLogger(["harakiri", "player", "fidelity"]);

/** The part of the mpv client the watcher needs, so tests can stand in for mpv. */
export interface FidelityMpv {
  getProperty<T>(name: string, schema: z.ZodType<T>): Promise<T>;
  setProperty(name: string, value: string | number): Promise<void>;
}

export interface WatchOptions {
  /** The mpv audio track that should be playing, or false for none. */
  readonly aid: () => number | false | undefined;
  readonly paused: () => boolean;
  /** Whether the stream has a picture to render. */
  readonly video: boolean;
  /** Where playback started, to return to if the outputs fail before ever playing. */
  readonly startSeconds: number;
  readonly onChange: (view: FidelityView) => void;
  readonly intervalMs?: number;
}

export interface FidelityWatch {
  view(): FidelityView;
  /** Call before switching the audio track: sets what mpv may bitstream for the new one. */
  selectSound(sound: SoundSource | null): Promise<void>;
  /** Call on each warning mpv logs about its audio output (`ao/…`). */
  audioOutputWarning(): void;
  /** Call on each error mpv logs about its video output (`vo/…`). */
  rendererError(): void;
  /** Starts sampling; call once the file has loaded. Warnings before it still count. */
  start(): void;
  /** One look at mpv; the interval calls it, and tests call it directly. */
  sample(): Promise<void>;
  stop(): void;
}

/** Samples kept to judge the audio output; a PipeWire stream that fails reopens and fails again. */
const AUDIO_WINDOW = 4;
const AUDIO_FAILURES = 3;

/** Samples a newly selected renderer gets to open its window before it is judged. */
const RENDERER_SETTLE = 4;

const RENDERER_OPTIONS: Readonly<Record<Renderer, { readonly vo: string; readonly api: string }>> =
  {
    vulkan: { vo: "gpu-next", api: "vulkan" },
    opengl: { vo: "gpu-next", api: "opengl" },
    "opengl-legacy": { vo: "gpu", api: "opengl" },
  };

const TargetParams = z.object({ gamma: z.string() });

const TrackList = z.array(
  z.object({ id: z.number(), type: z.string(), albumart: z.boolean().optional() })
);

const HDR_GAMMAS = new Set(["pq", "hlg"]);

/** Reads a property that mpv reports as unavailable while its subsystem is down. */
async function optional<T>(
  mpv: FidelityMpv,
  name: string,
  schema: z.ZodType<T>
): Promise<T | undefined> {
  try {
    return await mpv.getProperty(name, schema);
  } catch {
    return undefined;
  }
}

/**
 * Watches mpv's audio and video outputs, feeds what it sees to the fidelity engine, and applies
 * the engine's step-downs: a bitstream that stops playing is decoded, and a renderer that cannot
 * start gives way to the next one.
 */
export function watchFidelity(
  mpv: FidelityMpv,
  initial: FidelityState,
  options: WatchOptions
): FidelityWatch {
  let state = initial;
  let shown = JSON.stringify(fidelityView(state));
  let audioSamples: boolean[] = [];
  let audioWarnings = 0;
  let rendererErrors = 0;
  let settling = 0;
  let display: boolean | undefined;
  // With both outputs down mpv has no clock and races through the file, so a step-down returns
  // to the last moment something was playing.
  let lastHealthy: number | undefined;

  const apply = async (action: Action, reselect: boolean): Promise<void> => {
    await match(action)
      .with({ kind: "setBitstream" }, async ({ codecs }) => {
        await mpv.setProperty("audio-spdif", codecs.join(","));
        const aid = options.aid();

        // mpv picks passthrough when it opens the decoder, so a playing track is reopened.
        if (reselect && typeof aid === "number") {
          await mpv.setProperty("aid", "no");
          await mpv.setProperty("aid", aid);
        }
      })
      .with({ kind: "setRenderer" }, async ({ renderer }) => {
        const { vo, api } = RENDERER_OPTIONS[renderer];
        await mpv.setProperty("gpu-api", api);
        await mpv.setProperty("vo", vo);
        // mpv drops the video track when its output fails, and `vid=auto` does not bring it back
        // mid-file: the track is selected again by id, which opens the new renderer.
        const tracks = await optional(mpv, "track-list", TrackList);
        const video = tracks?.find((track) => track.type === "video" && track.albumart !== true);
        await mpv.setProperty("vid", video?.id ?? "auto");
      })
      .exhaustive();
  };

  const learn = async (observation: Observation, failure: boolean): Promise<void> => {
    const step = observe(state, observation);
    state = step.state;

    for (const action of step.actions) {
      await apply(action, failure).catch((error: unknown) => {
        logger.warn("Applying {action} failed: {error}", { action, error });
      });
    }

    if (failure) {
      await mpv
        .setProperty("time-pos", lastHealthy ?? options.startSeconds)
        .catch((error: unknown) =>
          logger.warn("Returning after a step-down failed: {error}", { error })
        );
    }

    const view = fidelityView(state);
    const next = JSON.stringify(view);

    if (next === shown) {
      return;
    }
    shown = next;

    for (const downgrade of view.downgrades) {
      logger.warn("Playing below best: {message}", { message: downgrade.message, downgrade });
    }

    options.onChange(view);
  };

  const sample = async (): Promise<void> => {
    const [ao, vo, position] = await Promise.all([
      optional(mpv, "current-ao", z.string()),
      optional(mpv, "current-vo", z.string()),
      optional(mpv, "time-pos", z.number()),
    ]);

    const audioSelected = typeof options.aid() === "number";

    // A PipeWire stream in error reopens about once a second, so with video keeping the clock
    // `current-ao` is present half the time; mpv's own warnings between samples settle it.
    const warned = audioWarnings > 0;
    audioWarnings = 0;

    if (audioSelected && !options.paused()) {
      audioSamples = [...audioSamples, ao !== undefined && !warned].slice(-AUDIO_WINDOW);
      const failures = audioSamples.filter((open) => !open).length;

      if (audioSamples.length === AUDIO_WINDOW && failures >= AUDIO_FAILURES) {
        audioSamples = [];
        await learn({ kind: "audioOutputFailed" }, true);
      }
    }

    // A PipeWire stream that keeps failing is open for a moment between attempts, so only a
    // whole window of open samples, or a working renderer, marks a moment worth returning to.
    const audioHealthy = audioSamples.length === AUDIO_WINDOW && audioSamples.every((open) => open);

    if (position !== undefined && ((options.video && vo !== undefined) || audioHealthy)) {
      lastHealthy = position;
    }

    const view = fidelityView(state);

    if (!options.video || view.renderer === "none") {
      return;
    }

    if (settling > 0) {
      settling -= 1;

      return;
    }

    // No video output alone proves nothing (`--vid=no` has none); mpv's error says it failed.
    const failed = vo === undefined && rendererErrors > 0;
    rendererErrors = 0;

    if (failed) {
      settling = RENDERER_SETTLE;
      display = undefined;
      await learn({ kind: "rendererFailed" }, true);

      return;
    }

    if (vo === undefined) {
      return;
    }
    const target = await optional(mpv, "video-target-params", TargetParams);

    if (target === undefined) {
      return;
    }
    const hdr = HDR_GAMMAS.has(target.gamma);

    if (hdr === display) {
      return;
    }
    display = hdr;
    await learn({ kind: "displayTarget", hdr }, false);
  };

  let timer: NodeJS.Timeout | undefined;

  return {
    view: () => fidelityView(state),
    selectSound: async (sound) => learn({ kind: "soundTrack", sound }, false),
    audioOutputWarning: () => {
      audioWarnings += 1;
    },
    rendererError: () => {
      rendererErrors += 1;
    },
    start: () => {
      timer ??= setInterval(() => {
        void sample().catch((error: unknown) =>
          logger.warn("Fidelity sample failed: {error}", { error })
        );
      }, options.intervalMs ?? 500);
    },
    sample,
    stop: () => clearInterval(timer),
  };
}
