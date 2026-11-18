import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { joinFacts } from "@harakiri/jellyfin";

import { elementaryStream, readPcm16, scanBursts } from "../../../packages/harness/src/index";
import {
  expect,
  play,
  playerEventUntil,
  probeUntil,
  recordPlayerEvents,
  test,
} from "./support/harakiri";
import { ITEMS, TICKS_PER_SECOND } from "./support/jellyfin";
import { pressKey } from "./support/mpv";

// ao_pcm writes what the audio device would have received, but untimed: unpaused, it races
// through about 20 s of audio per wall-clock second. So mpv starts paused for the probe, and
// `--length` ends the capture after exactly a case's capture seconds of content. `--vid=no` keeps
// 4K remuxes from burning CPU on a video decode this tier does not look at.
const captureArgs = (userDataDir: string, seconds: number) =>
  `--vo=null --vid=no --ao=pcm --ao-pcm-file=${join(userDataDir, "capture.wav")} --pause --length=${seconds}`;

test.use({
  // ao_pcm stands in for a receiver, so the fidelity engine is told it plays to one.
  extraEnv: {
    HARAKIRI_AUDIO_OUTPUT: JSON.stringify({
      kind: "known",
      name: "test receiver",
      bitstream: ["ac3", "eac3", "dts", "dts-hd", "truehd"],
    }),
  },
});

test.beforeEach(({ signIn }) => signIn());

const cases = [
  {
    name: "E-AC3",
    criteria: ITEMS.eac3,
    codec: "eac3",
    signalPath: "SDR · E-AC3 bitstream",
    burst: "eac3",
    // One burst per 1536-sample syncframe at 48 kHz.
    burstsPerSecond: 48_000 / 1536,
    sync: [0x0b, 0x77],
    startSeconds: 60,
    captureSeconds: 5,
  },
  {
    name: "TrueHD Atmos",
    criteria: ITEMS.truehdAtmos,
    codec: "truehd",
    signalPath: "SDR · TrueHD Atmos bitstream",
    burst: "mat",
    // One MAT frame per 24 access units of 1/1200 s.
    burstsPerSecond: 1200 / 24,
    // The TrueHD major sync word, which every few access units repeat.
    sync: [0xf8, 0x72, 0x6f, 0xba],
    // FFmpeg cannot encode Atmos, so the corpus carries the 3 s FATE sample: the capture starts
    // at the top and stays inside it.
    startSeconds: 0,
    captureSeconds: 2,
  },
] as const;

for (const c of cases) {
  const { name, criteria, codec, signalPath, burst, burstsPerSecond, sync } = c;
  test.describe(() => {
    test.use({
      mpvArgs: async ({ userDataDir }, use) => {
        await use(captureArgs(userDataDir, c.captureSeconds));
      },
    });
    test(`${name} reaches the audio output as an IEC 61937 bitstream`, async ({
      launch,
      jellyfin,
      userDataDir,
      preserveUserData,
    }, testInfo) => {
      const item = await jellyfin.pickItem(criteria);

      if (!item.audio) {
        throw new Error(`${item.name} has no matching audio stream`);
      }
      await preserveUserData(item.id);
      const { page } = await launch();
      await recordPlayerEvents(page);
      const startedAt = Date.now();

      await play(page, {
        itemId: item.id,
        mediaSourceId: item.mediaSourceId,
        audioStreamIndex: item.audio.Index,
        startPositionTicks: c.startSeconds * TICKS_PER_SECOND,
      });

      const live = await probeUntil(page, (p) => p.audioSpdif !== undefined);
      expect(live.pause).toBe(true);
      expect(live.audioSpdif).toBe(true);
      expect(live.audioCodec).toBe(codec);
      const paused = await playerEventUntil(page, (event) => event.phase === "paused");
      expect(joinFacts(paused.facts)).toBe(signalPath);

      await pressKey(userDataDir, "SPACE");
      // Untimed, mpv reaches the end before reporting any later time-pos, so the ended event's
      // position is not checked here; the burst count below measures the captured length.
      await playerEventUntil(page, (event) => event.phase === "ended", 30_000);

      const wav = readFileSync(join(userDataDir, "capture.wav"));
      const pcm = readPcm16(wav);
      const bursts = scanBursts(pcm.data);
      const payload = bursts.filter((b) => b.name === burst);
      const stream = elementaryStream(bursts);
      await testInfo.attach("capture", {
        contentType: "application/json",
        body: JSON.stringify({
          item: item.name,
          wavBytes: statSync(join(userDataDir, "capture.wav")).size,
          wallSeconds: (Date.now() - startedAt) / 1000,
          format:
            pcm.kind === "wav" ? { channels: pcm.channels, sampleRate: pcm.sampleRate } : "raw",
          bursts: bursts.length,
          payloadBursts: payload.length,
          streamBytes: stream.bytes.length,
        }),
      });

      // elementaryStream throws if the capture mixes codecs, so this also proves nothing else got through.
      expect(stream.codec).toBe(codec);
      const expected = burstsPerSecond * c.captureSeconds;
      expect(payload.length).toBeGreaterThanOrEqual(Math.floor(expected * 0.9));
      expect(payload.length).toBeLessThanOrEqual(Math.ceil(expected * 1.1));
      expect(indexOfSequence(stream.bytes, sync)).toBeGreaterThanOrEqual(0);
    });
  });
}

function indexOfSequence(bytes: Uint8Array, sequence: readonly number[]): number {
  outer: for (let i = 0; i + sequence.length <= bytes.length; i++) {
    for (let j = 0; j < sequence.length; j++) {
      if (bytes[i + j] !== sequence[j]) continue outer;
    }

    return i;
  }

  return -1;
}
