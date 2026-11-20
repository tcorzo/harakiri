import { setImmediate } from "node:timers/promises";

import { startFidelity } from "@harakiri/fidelity";
import type { AudioOutput } from "@harakiri/fidelity";
import { afterEach, describe, expect, it } from "vitest";
import type { z } from "zod";

import { watchFidelity } from "./fidelity-watch";
import type { FidelityMpv, FidelityWatch } from "./fidelity-watch";

/** A property value as mpv reports it to the watcher. */
type MpvValue =
  | string
  | number
  | { readonly gamma: string }
  | readonly { readonly id: number; readonly type: string; readonly albumart?: boolean }[];

type SetValue = Parameters<FidelityMpv["setProperty"]>[1];

/**
 * Stands in for mpv. Properties absent from `props` read as unavailable, as mpv reports a dead
 * output. `react` changes them when the watcher sets something, as mpv did in the probes.
 */
const fakeMpv = (props: Map<string, MpvValue>, react: (name: string, value: SetValue) => void) => {
  const sets: [string, SetValue][] = [];

  const mpv: FidelityMpv = {
    getProperty: async <T>(name: string, schema: z.ZodType<T>) => {
      if (!props.has(name)) {
        throw new Error("property unavailable");
      }

      const value = schema.parse(props.get(name));
      // mpv answers over its IPC socket, so the stand-in answers on a later turn as well.
      await setImmediate();

      return value;
    },
    setProperty: async (name, value) => {
      sets.push([name, value]);
      react(name, value);
      await setImmediate();
    },
  };

  return { mpv, sets };
};

const receiver: AudioOutput = { kind: "known", name: "AV receiver", bitstream: ["eac3", "truehd"] };

const start = () =>
  startFidelity({
    picture: { range: "HDR10", label: "HDR10" },
    sound: { carriage: "eac3", label: "E-AC3" },
    delivery: { kind: "direct" },
    output: receiver,
  });

const watches: FidelityWatch[] = [];

const watcherOn = (mpv: FidelityMpv, options: { paused?: boolean } = {}) => {
  const changes: string[][] = [];

  const watcher = watchFidelity(mpv, start(), {
    aid: () => 1,
    paused: () => options.paused ?? false,
    video: true,
    startSeconds: 0,
    intervalMs: 60_000,
    onChange: (view) => {
      changes.push(view.facts.map((fact) => fact.text));
    },
  });

  watches.push(watcher);

  return { watcher, changes };
};

/** Samples once per step, after `before` sets up what mpv shows for that step. */
const sampleEach = async <T>(
  watcher: FidelityWatch,
  steps: readonly T[],
  before: (step: T) => void
) => {
  for (const step of steps) {
    before(step);
    // oxlint-disable-next-line eslint/no-await-in-loop -- each sample reads the state the previous one left
    await watcher.sample();
  }
};

const samples = async (watcher: FidelityWatch, count: number) => {
  await sampleEach(watcher, Array.from({ length: count }), () => {});
};

describe("fidelity watcher", () => {
  afterEach(() => {
    for (const watch of watches.splice(0)) {
      watch.stop();
    }
  });

  it("a bitstream whose output keeps dying is switched to decoding, and the track reopened", async () => {
    const props = new Map<string, MpvValue>([
      ["current-vo", "gpu-next"],
      ["video-target-params", { gamma: "pq" }],
    ]);

    const { mpv, sets } = fakeMpv(props, (name, value) => {
      if (name === "aid" && value === 1 && props.get("audio-spdif") === "") {
        props.set("current-ao", "pipewire");
      }

      if (name === "audio-spdif") {
        props.set("audio-spdif", value);
      }
    });

    const { watcher, changes } = watcherOn(mpv);

    await samples(watcher, 3);
    expect(sets).toStrictEqual([]);
    await samples(watcher, 1);
    expect(sets).toStrictEqual([
      ["audio-spdif", ""],
      ["aid", "no"],
      ["aid", 1],
      ["time-pos", 0],
    ]);
    expect(changes.at(-1)).toStrictEqual(["HDR10", "E-AC3 decoded to PCM"]);
    expect(watcher.view().downgrades.map((d) => d.message)).toStrictEqual([
      "AV receiver stopped taking the E-AC3 bitstream, so harakiri decodes it.",
    ]);

    await samples(watcher, 8);
    expect(sets).toHaveLength(4);
  });

  it("one dropped sample out of four is a reopen, not a failure", async () => {
    const props = new Map<string, MpvValue>([["current-vo", "gpu-next"]]);
    const { mpv, sets } = fakeMpv(props, () => {});
    const { watcher } = watcherOn(mpv);

    await sampleEach(watcher, [true, false, true, true, false, true, true, true], (open) => {
      if (open) {
        props.set("current-ao", "pipewire");
      } else {
        props.delete("current-ao");
      }
    });

    expect(sets).toStrictEqual([]);
  });

  it("an output that reopens between samples is caught by mpv's warnings", async () => {
    const props = new Map<string, MpvValue>([
      ["current-ao", "pipewire"],
      ["current-vo", "gpu-next"],
    ]);

    const { mpv, sets } = fakeMpv(props, () => {});
    const { watcher } = watcherOn(mpv);

    await sampleEach(watcher, Array.from({ length: 4 }), () => {
      watcher.audioOutputWarning();
    });

    expect(sets[0]).toStrictEqual(["audio-spdif", ""]);
  });

  it("a paused player is not judged on its audio output", async () => {
    const { mpv, sets } = fakeMpv(
      new Map<string, MpvValue>([["current-vo", "gpu-next"]]),
      () => {}
    );

    const { watcher } = watcherOn(mpv, { paused: true });
    await samples(watcher, 6);
    expect(sets).toStrictEqual([]);
  });

  it("a renderer that cannot start gives way to OpenGL, which then shows the picture", async () => {
    const props = new Map<string, MpvValue>([
      ["current-ao", "pipewire"],
      [
        "track-list",
        [
          { id: 1, type: "audio" },
          { id: 1, type: "video" },
          { id: 2, type: "video", albumart: true },
        ],
      ],
    ]);

    const { mpv, sets } = fakeMpv(props, (name, value) => {
      if (name === "vid" && value === 1) {
        props.set("current-vo", "gpu-next");
        props.set("video-target-params", { gamma: "bt.1886" });
      }
    });

    const { watcher, changes } = watcherOn(mpv);

    watcher.rendererError();
    await samples(watcher, 1);
    expect(sets).toStrictEqual([
      ["gpu-api", "opengl"],
      ["vo", "gpu-next"],
      ["vid", 1],
      ["time-pos", 0],
    ]);
    await samples(watcher, 1);
    expect(changes.at(-1)).toStrictEqual(["HDR10 tone-mapped to SDR", "E-AC3 bitstream"]);
    expect(watcher.view().downgrades.map((d) => d.reason)).toStrictEqual([
      { kind: "rendererFailed", renderer: "opengl" },
    ]);
  });

  it("an HDR display leaves the picture as it is, and an SDR one is reported", async () => {
    const props = new Map<string, MpvValue>([
      ["current-ao", "pipewire"],
      ["current-vo", "gpu-next"],
      ["video-target-params", { gamma: "pq" }],
    ]);

    const { mpv } = fakeMpv(props, () => {});
    const { watcher } = watcherOn(mpv);
    await samples(watcher, 2);
    expect(watcher.view().downgrades).toStrictEqual([]);

    props.set("video-target-params", { gamma: "bt.1886" });
    await samples(watcher, 1);
    expect(watcher.view().downgrades.map((d) => d.reason)).toStrictEqual([{ kind: "displaySdr" }]);
  });

  it("a step-down returns to the last moment an output was playing", async () => {
    const props = new Map<string, MpvValue>([
      ["current-vo", "gpu-next"],
      ["time-pos", 41.5],
    ]);

    const { mpv, sets } = fakeMpv(props, () => {});
    const { watcher } = watcherOn(mpv);
    await samples(watcher, 1);
    props.set("time-pos", 300);
    props.delete("current-vo");
    watcher.rendererError();
    await samples(watcher, 1);
    expect(sets.find(([name]) => name === "time-pos")).toStrictEqual(["time-pos", 41.5]);
  });

  it("no video output without mpv's error is a choice, not a failed renderer", async () => {
    const { mpv, sets } = fakeMpv(
      new Map<string, MpvValue>([["current-ao", "pipewire"]]),
      () => {}
    );

    const { watcher } = watcherOn(mpv);
    await samples(watcher, 6);
    expect(sets).toStrictEqual([]);
  });

  it("choosing a track after the output broke keeps mpv decoding", async () => {
    const props = new Map<string, MpvValue>([["current-vo", "gpu-next"]]);
    const { mpv, sets } = fakeMpv(props, () => {});
    const { watcher } = watcherOn(mpv);
    await samples(watcher, 4);
    sets.length = 0;
    await watcher.selectSound({ carriage: "truehd", label: "TrueHD Atmos" });
    expect(sets).toStrictEqual([]);
    expect(watcher.view().facts[1]).toStrictEqual({
      text: "TrueHD Atmos decoded to PCM",
      state: "decoded",
    });
  });
});
