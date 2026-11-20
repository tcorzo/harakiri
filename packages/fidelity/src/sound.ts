import { match } from "ts-pattern";

import type {
  AudioOutput,
  BitstreamCodec,
  Downgrade,
  DowngradeReason,
  Fact,
  SoundSource,
} from "./model";

/** What is known about the audio output beyond what it says it takes. */
export interface SoundWorld {
  readonly output: AudioOutput;
  /** A bitstream the output listed stopped playing: decode from here on. */
  readonly bitstreamFailed: boolean;
  /** Decoded sound stopped playing too: there is no rung left. */
  readonly silent: boolean;
}

export interface SoundResult {
  /** What mpv may send as a bitstream. Empty means mpv decodes everything. */
  readonly bitstream: readonly BitstreamCodec[];
  readonly fact: Fact | null;
  readonly downgrade: Downgrade | null;
}

/** The fact for a track at its best: bitstreamed when compressed, PCM when PCM. */
export const bestSoundFact = (sound: SoundSource): Fact =>
  match(sound.carriage)
    .with("pcm", (): Fact => ({ text: "PCM", state: "native" }))
    .with("decode", (): Fact => decoded(sound))
    .otherwise((): Fact => ({ text: `${sound.label} bitstream`, state: "native" }));

const decoded = (sound: SoundSource): Fact => ({
  text: `${sound.label} decoded to PCM`,
  state: "decoded",
});

const silence: Fact = { text: "No sound", state: "decoded" };

/**
 * The codecs mpv may bitstream for this track. A DTS-HD track never falls to the DTS core: an
 * output without DTS-HD gets it decoded, which keeps it lossless, where the core is lossy.
 */
const bitstreamFor = (sound: SoundSource | null, world: SoundWorld): readonly BitstreamCodec[] => {
  if (world.output.kind === "unknown" || world.bitstreamFailed || world.silent) {
    return [];
  }

  const listed = world.output.bitstream;

  return sound?.carriage === "dts-hd" && !listed.includes("dts-hd")
    ? listed.filter((codec) => codec !== "dts")
    : listed;
};

const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const message = (reason: DowngradeReason, sound: SoundSource, to: Fact): string =>
  sentence(
    match(reason)
      .with(
        { kind: "outputRefuses" },
        (r) => `${r.output} does not take ${sound.label} as a bitstream, so harakiri decodes it.`
      )
      .with(
        { kind: "outputUnknown" },
        () => `harakiri could not tell what the audio output takes, so it decodes ${sound.label}.`
      )
      .with({ kind: "outputFailed" }, (r) =>
        to === silence
          ? `${r.output ?? "The audio output"} stopped playing sound. The picture carries on without it.`
          : `${r.output ?? "The audio output"} stopped taking the ${sound.label} bitstream, so harakiri decodes it.`
      )
      .otherwise(() => "")
  );

const outputName = (output: AudioOutput): string | null =>
  output.kind === "known" ? output.name : null;

const declineReason = (world: SoundWorld): DowngradeReason => {
  if (world.bitstreamFailed) {
    return { kind: "outputFailed", output: outputName(world.output) };
  }

  if (world.output.kind === "unknown") {
    return { kind: "outputUnknown", detail: world.output.detail };
  }

  return { kind: "outputRefuses", output: world.output.name };
};

/** Decides how the selected track plays on this output, and why when it is less than its best. */
export const soundPlan = (sound: SoundSource | null, world: SoundWorld): SoundResult => {
  const bitstream = bitstreamFor(sound, world);

  if (sound === null) {
    return { bitstream, fact: null, downgrade: null };
  }

  const best = bestSoundFact(sound);

  const lowered = (fact: Fact, reason: DowngradeReason): SoundResult => ({
    bitstream,
    fact,
    downgrade: {
      leg: "sound",
      from: best.text,
      to: fact.text,
      reason,
      message: message(reason, sound, fact),
    },
  });

  if (world.silent) {
    return lowered(silence, { kind: "outputFailed", output: outputName(world.output) });
  }

  const { carriage } = sound;

  if (carriage === "pcm" || carriage === "decode") {
    return { bitstream, fact: best, downgrade: null };
  }

  if (bitstream.includes(carriage)) {
    return { bitstream, fact: best, downgrade: null };
  }

  return lowered(decoded(sound), declineReason(world));
};

/** Whether the selected track is going out as a bitstream right now. */
export const isBitstreaming = (sound: SoundSource | null, world: SoundWorld): boolean =>
  sound !== null &&
  sound.carriage !== "pcm" &&
  sound.carriage !== "decode" &&
  bitstreamFor(sound, world).includes(sound.carriage);
