import { startFidelity } from "@harakiri/fidelity";
import type { AudioOutput } from "@harakiri/fidelity";
import { afterEach, expect, test } from "vitest";
import type { z } from "zod";

import { watchFidelity } from "./fidelity-watch";
import type { FidelityMpv, FidelityWatch } from "./fidelity-watch";

/**
 * Stands in for mpv. Properties absent from `props` read as unavailable, as mpv reports a dead
 * output. `react` changes them when the watcher sets something, as mpv did in the probes.
 */
function fakeMpv(props: Record<string, unknown>, react: (name: string, value: unknown) => void) {
  const sets: [string, unknown][] = [];

  const mpv: FidelityMpv = {
    getProperty: async <T>(name: string, schema: z.ZodType<T>) => {
      if (!(name in props)) {
        throw new Error("property unavailable");
      }

      return schema.parse(props[name]);
    },
    setProperty: async (name, value) => {
      sets.push([name, value]);
      react(name, value);
    },
  };

  return { mpv, sets };
}

const receiver: AudioOutput = { kind: "known", name: "AV receiver", bitstream: ["eac3", "truehd"] };

const start = () =>
  startFidelity({
    picture: { range: "HDR10", label: "HDR10" },
    sound: { carriage: "eac3", label: "E-AC3" },
    delivery: { kind: "direct" },
    output: receiver,
  });

const watches: FidelityWatch[] = [];

afterEach(() => {
  for (const watch of watches.splice(0)) {
    watch.stop();
  }
});

function watcherOn(mpv: FidelityMpv, options: { paused?: boolean } = {}) {
  const changes: string[][] = [];

  const watcher = watchFidelity(mpv, start(), {
    aid: () => 1,
    paused: () => options.paused ?? false,
    video: true,
    startSeconds: 0,
    intervalMs: 60_000,
    onChange: (view) => changes.push(view.facts.map((fact) => fact.text)),
  });

  watches.push(watcher);

  return { watcher, changes };
}

async function samples(watcher: FidelityWatch, count: number) {
  for (let i = 0; i < count; i += 1) {
    await watcher.sample();
  }
}

test("a bitstream whose output keeps dying is switched to decoding, and the track reopened", async () => {
  const props: Record<string, unknown> = {
    "current-vo": "gpu-next",
    "video-target-params": { gamma: "pq" },
  };

  const { mpv, sets } = fakeMpv(props, (name, value) => {
    if (name === "aid" && value === 1 && props["audio-spdif"] === "") {
      props["current-ao"] = "pipewire";
    }

    if (name === "audio-spdif") {
      props["audio-spdif"] = value;
    }
  });

  const { watcher, changes } = watcherOn(mpv);

  await samples(watcher, 3);
  expect(sets).toEqual([]);
  await samples(watcher, 1);
  expect(sets).toEqual([
    ["audio-spdif", ""],
    ["aid", "no"],
    ["aid", 1],
    ["time-pos", 0],
  ]);
  expect(changes.at(-1)).toEqual(["HDR10", "E-AC3 decoded to PCM"]);
  expect(watcher.view().downgrades.map((d) => d.message)).toEqual([
    "AV receiver stopped taking the E-AC3 bitstream, so harakiri decodes it.",
  ]);

  await samples(watcher, 8);
  expect(sets).toHaveLength(4);
});

test("one dropped sample out of four is a reopen, not a failure", async () => {
  const props: Record<string, unknown> = { "current-vo": "gpu-next" };
  const { mpv, sets } = fakeMpv(props, () => {});
  const { watcher } = watcherOn(mpv);

  for (const open of [true, false, true, true, false, true, true, true]) {
    if (open) {
      props["current-ao"] = "pipewire";
    } else {
      delete props["current-ao"];
    }
    await watcher.sample();
  }

  expect(sets).toEqual([]);
});

test("an output that reopens between samples is caught by mpv's warnings", async () => {
  const props: Record<string, unknown> = { "current-ao": "pipewire", "current-vo": "gpu-next" };
  const { mpv, sets } = fakeMpv(props, () => {});
  const { watcher } = watcherOn(mpv);

  for (let i = 0; i < 4; i += 1) {
    watcher.audioOutputWarning();
    await watcher.sample();
  }

  expect(sets[0]).toEqual(["audio-spdif", ""]);
});

test("a paused player is not judged on its audio output", async () => {
  const { mpv, sets } = fakeMpv({ "current-vo": "gpu-next" }, () => {});
  const { watcher } = watcherOn(mpv, { paused: true });
  await samples(watcher, 6);
  expect(sets).toEqual([]);
});

test("a renderer that cannot start gives way to OpenGL, which then shows the picture", async () => {
  const props: Record<string, unknown> = {
    "current-ao": "pipewire",
    "track-list": [
      { id: 1, type: "audio" },
      { id: 1, type: "video" },
      { id: 2, type: "video", albumart: true },
    ],
  };

  const { mpv, sets } = fakeMpv(props, (name, value) => {
    if (name === "vid" && value === 1) {
      props["current-vo"] = "gpu-next";
      props["video-target-params"] = { gamma: "bt.1886" };
    }
  });

  const { watcher, changes } = watcherOn(mpv);

  watcher.rendererError();
  await samples(watcher, 1);
  expect(sets).toEqual([
    ["gpu-api", "opengl"],
    ["vo", "gpu-next"],
    ["vid", 1],
    ["time-pos", 0],
  ]);
  await samples(watcher, 1);
  expect(changes.at(-1)).toEqual(["HDR10 tone-mapped to SDR", "E-AC3 bitstream"]);
  expect(watcher.view().downgrades.map((d) => d.reason)).toEqual([
    { kind: "rendererFailed", renderer: "opengl" },
  ]);
});

test("an HDR display leaves the picture as it is, and an SDR one is reported", async () => {
  const props: Record<string, unknown> = {
    "current-ao": "pipewire",
    "current-vo": "gpu-next",
    "video-target-params": { gamma: "pq" },
  };

  const { mpv } = fakeMpv(props, () => {});
  const { watcher } = watcherOn(mpv);
  await samples(watcher, 2);
  expect(watcher.view().downgrades).toEqual([]);

  props["video-target-params"] = { gamma: "bt.1886" };
  await samples(watcher, 1);
  expect(watcher.view().downgrades.map((d) => d.reason)).toEqual([{ kind: "displaySdr" }]);
});

test("a step-down returns to the last moment an output was playing", async () => {
  const props: Record<string, unknown> = { "current-vo": "gpu-next", "time-pos": 41.5 };
  const { mpv, sets } = fakeMpv(props, () => {});
  const { watcher } = watcherOn(mpv);
  await samples(watcher, 1);
  props["time-pos"] = 300;
  delete props["current-vo"];
  watcher.rendererError();
  await samples(watcher, 1);
  expect(sets.find(([name]) => name === "time-pos")).toEqual(["time-pos", 41.5]);
});

test("no video output without mpv's error is a choice, not a failed renderer", async () => {
  const { mpv, sets } = fakeMpv({ "current-ao": "pipewire" }, () => {});
  const { watcher } = watcherOn(mpv);
  await samples(watcher, 6);
  expect(sets).toEqual([]);
});

test("choosing a track after the output broke keeps mpv decoding", async () => {
  const props: Record<string, unknown> = { "current-vo": "gpu-next" };
  const { mpv, sets } = fakeMpv(props, () => {});
  const { watcher } = watcherOn(mpv);
  await samples(watcher, 4);
  sets.length = 0;
  await watcher.selectSound({ carriage: "truehd", label: "TrueHD Atmos" });
  expect(sets).toEqual([]);
  expect(watcher.view().facts[1]).toEqual({
    text: "TrueHD Atmos decoded to PCM",
    state: "decoded",
  });
});
