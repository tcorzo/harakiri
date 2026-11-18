import { match } from "ts-pattern";

import type {
  Action,
  AudioOutput,
  BitstreamCodec,
  Delivery,
  Downgrade,
  Fact,
  Observation,
  PictureSource,
  Renderer,
  SoundSource,
} from "./model";
import { bestPictureFact, nextRenderer, picturePlan } from "./picture";
import type { PictureWorld } from "./picture";
import { bestSoundFact, isBitstreaming, soundPlan } from "./sound";
import type { SoundWorld } from "./sound";

/**
 * What is known about one playback: the file, how the server sends it, and what the output path
 * has shown so far. Everything the player acts on is derived from it by `fidelityView`.
 */
export interface FidelityState {
  readonly picture: PictureSource | null;
  readonly sound: SoundSource | null;
  readonly delivery: Delivery;
  readonly soundWorld: SoundWorld;
  readonly pictureWorld: PictureWorld;
}

export interface FidelityView {
  /** What mpv may bitstream (`--audio-spdif`). */
  readonly bitstream: readonly BitstreamCodec[];
  readonly renderer: Renderer | "none";
  /** The signal path as it plays: the picture leg, then the sound leg. */
  readonly facts: readonly Fact[];
  /** Every way the playback is below its best right now, picture first. */
  readonly downgrades: readonly Downgrade[];
}

export interface FidelityStart {
  readonly picture: PictureSource | null;
  readonly sound: SoundSource | null;
  readonly delivery: Delivery;
  readonly output: AudioOutput;
}

export function startFidelity(start: FidelityStart): FidelityState {
  return {
    picture: start.picture,
    sound: start.sound,
    delivery: start.delivery,
    soundWorld: { output: start.output, bitstreamFailed: false, silent: false },
    pictureWorld: { renderer: "vulkan", display: "unknown" },
  };
}

/** What actually plays: the file's own streams, or the server's transcode of them. */
const played = (state: FidelityState) =>
  state.delivery.kind === "direct"
    ? { picture: state.picture, sound: state.sound }
    : { picture: state.delivery.picture, sound: state.delivery.sound };

function transcoded<T extends { readonly label: string }>(
  leg: Downgrade["leg"],
  source: T | null,
  output: T | null,
  best: (stream: T) => Fact,
  delivery: Delivery
): Downgrade | null {
  if (delivery.kind !== "transcode" || source === null) {
    return null;
  }
  const none = leg === "sound" ? "No sound" : "No picture";
  const from = best(source).text;
  const to = output === null ? none : best(output).text;

  if (from === to) {
    return null;
  }
  const why = delivery.reasons.length === 0 ? "" : ` (${delivery.reasons.join(", ")})`;
  const into = output === null ? "nothing" : output.label;

  return {
    leg,
    from,
    to,
    reason: { kind: "serverTranscode", reasons: delivery.reasons },
    message: `The server converts ${source.label} to ${into}${why}.`,
  };
}

export function fidelityView(state: FidelityState): FidelityView {
  const now = played(state);
  const picture = picturePlan(now.picture, state.pictureWorld);
  const sound = soundPlan(now.sound, state.soundWorld);

  const downgrades = [
    transcoded("picture", state.picture, now.picture, bestPictureFact, state.delivery),
    picture.downgrade,
    transcoded("sound", state.sound, now.sound, bestSoundFact, state.delivery),
    sound.downgrade,
  ].filter((downgrade): downgrade is Downgrade => downgrade !== null);

  return {
    bitstream: sound.bitstream,
    renderer: state.pictureWorld.renderer,
    facts: [picture.fact, sound.fact].filter((fact): fact is Fact => fact !== null),
    downgrades,
  };
}

function learn(state: FidelityState, observation: Observation): FidelityState {
  return (
    match(observation)
      .with({ kind: "audioOutputFailed" }, (): FidelityState => {
        const { sound } = played(state);

        if (sound === null) {
          return state;
        }

        // A failed bitstream steps down to decoding; failed decoding leaves nothing below it.
        const soundWorld = isBitstreaming(sound, state.soundWorld)
          ? { ...state.soundWorld, bitstreamFailed: true }
          : { ...state.soundWorld, silent: true };

        return { ...state, soundWorld };
      })
      .with({ kind: "rendererFailed" }, (): FidelityState => ({
        ...state,
        // A new renderer has not shown what the display takes yet.
        pictureWorld: { renderer: nextRenderer(state.pictureWorld.renderer), display: "unknown" },
      }))
      .with({ kind: "displayTarget" }, ({ hdr }): FidelityState => ({
        ...state,
        pictureWorld: { ...state.pictureWorld, display: hdr ? "hdr" : "sdr" },
      }))
      // In a transcode the server's output plays; a track change there is a new transcode.
      .with({ kind: "soundTrack" }, ({ sound }): FidelityState => ({ ...state, sound }))
      .exhaustive()
  );
}

const sameCodecs = (a: readonly BitstreamCodec[], b: readonly BitstreamCodec[]): boolean =>
  a.length === b.length && a.every((codec, index) => codec === b[index]);

/** Folds in what the player saw, and returns what it must change in mpv to match. */
export function observe(
  state: FidelityState,
  observation: Observation
): { readonly state: FidelityState; readonly actions: readonly Action[] } {
  const before = fidelityView(state);
  const next = learn(state, observation);
  const after = fidelityView(next);
  const actions: Action[] = [];

  if (!sameCodecs(before.bitstream, after.bitstream)) {
    actions.push({ kind: "setBitstream", codecs: after.bitstream });
  }

  if (after.renderer !== before.renderer && after.renderer !== "none") {
    actions.push({ kind: "setRenderer", renderer: after.renderer });
  }

  return { state: next, actions };
}
