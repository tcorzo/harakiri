import { afterAll, describe, expect, it } from "vitest";

import { ServerVersion, playbackInfoRequest } from "../device-profile";
import type { DeviceProfile, MediaSourceInfo, MediaStream } from "../generated/types.gen";
import { corpusEntry, loadCorpus, matchCorpus } from "./corpus";
import type { CorpusEntry } from "./corpus";
import {
  SERVER,
  decide,
  describeDecision,
  libraryItems,
  mapLimit,
  playbackInfo,
  serverUnreachable,
  signIn,
} from "./server";
import type { LibraryItem } from "./server";

// The contract tier (`mise run test:contract`), kept out of `mise run test`. It fails, never
// skips, when the server is down. On the generated corpus every assertion is exact; pointed at
// another library (JELLYFIN_DEV_URL) it checks one item per stream class the server holds and
// reports every item that would not direct play.
const unreachable = await serverUnreachable();

if (unreachable !== undefined) {
  throw new Error(
    `${unreachable}: set JELLYFIN_DEV_URL (and JELLYFIN_DEV_USER, JELLYFIN_DEV_PASSWORD) to your server, or run \`mise run jellyfin:up\` for the dev container`
  );
}

const corpus = await loadCorpus();

// The test list depends on what the server holds, so the library is read at collection time.
const session = await signIn();

const library = await libraryItems(session);
const onCorpus = matchCorpus(corpus, library);

const ours = playbackInfoRequest({
  userId: session.userId,
  server: ServerVersion.parse(session.serverVersion),
  source: { kind: "default" },
});

const audioStreams = (source: MediaSourceInfo | undefined) =>
  (source?.MediaStreams ?? [])
    .filter((stream) => stream.Type === "Audio")
    .map(({ Codec, Profile, Channels }) => ({ Codec, Profile: Profile ?? null, Channels }));

const videoStream = (item: LibraryItem): MediaStream | undefined =>
  item.sources[0]?.MediaStreams?.find((stream) => stream.Type === "Video");

/** Video codec, range, Dolby Vision profile and audio codecs: what decides a direct play. */
const streamClass = (item: LibraryItem): string => {
  const video = videoStream(item);
  const dvProfile = video?.DvProfile ?? 0;
  const dv = dvProfile === 0 ? "" : ` P${dvProfile}`;
  const audio = audioStreams(item.sources[0]).map((stream) => stream.Codec ?? "?");

  return `${video?.Codec ?? "no video"} ${video?.VideoRangeType ?? "?"}${dv} · ${audio.join("+") || "no audio"}`;
};

const bitrate = (item: LibraryItem): number => item.sources[0]?.Bitrate ?? 0;

type Subject = readonly [name: string, item: () => LibraryItem, entry: CorpusEntry | undefined];

const firstOfEachClass = new Map<string, LibraryItem>();

for (const item of library) {
  if (!firstOfEachClass.has(streamClass(item))) {
    firstOfEachClass.set(streamClass(item), item);
  }
}

const subjects: readonly Subject[] = onCorpus
  ? corpus.entries.map((entry): Subject => [entry.id, () => onCorpus.item(entry), entry])
  : [...firstOfEachClass].map(([cls, item]): Subject => [cls, () => item, undefined]);

const pick = (id: string, fallback: () => LibraryItem | undefined, what: string) => {
  if (onCorpus) {
    return onCorpus.item(corpusEntry(corpus, id));
  }

  const item = fallback();

  if (!item) {
    throw new Error(`${SERVER} holds no ${what}, which this control needs`);
  }

  return item;
};

describe(`${SERVER} never transcodes under harakiri's profile`, () => {
  afterAll(async () => {
    await session.end();
  });

  // On the corpus, every catalog entry with the audio it declares; elsewhere, one item per class.
  describe("each subject direct plays with harakiri's request", () => {
    it.each(subjects)("%s", async (subject, itemOf, entry) => {
      const item = itemOf();
      const response = await playbackInfo(session, item.id, ours);
      const chosen = response.MediaSources?.[0];
      const indexed = item.sources.find((source) => source.Id === chosen?.Id);

      expect({
        subject,
        decision: describeDecision(decide(response)),
        sourcesWithTranscodingUrl: (response.MediaSources ?? [])
          .filter((source) => (source.TranscodingUrl ?? "") !== "")
          .map((source) => source.Name),
        audio: audioStreams(chosen),
      }).toStrictEqual({
        subject,
        decision: "direct play",
        sourcesWithTranscodingUrl: [],
        audio: entry
          ? entry.expect.audio.map((audio) => ({
              Codec: audio.codec,
              Profile: audio.profile,
              Channels: audio.channels,
            }))
          : audioStreams(indexed),
      });
    });
  });

  describe("negative controls", () => {
    it("Jellyfin Desktop's DOVI condition transcodes DV Profile 5 for VideoRangeTypeNotSupported", async () => {
      const desktop: DeviceProfile = {
        ...ours.DeviceProfile,
        CodecProfiles: [
          {
            Type: "Video",
            Conditions: [{ Condition: "NotEquals", Property: "VideoRangeType", Value: "DOVI" }],
          },
        ],
      };

      const item = pick(
        "dv-p5-hevc-episode",
        () => library.find((candidate) => videoStream(candidate)?.DvProfile === 5),
        "Dolby Vision profile 5 item"
      );

      const decision = decide(
        await playbackInfo(session, item.id, { ...ours, DeviceProfile: desktop })
      );

      console.info(`[contract] Desktop profile, ${item.name}: ${describeDecision(decision)}`);

      // The corpus item is exact; another library's is whichever DV profile 5 item it holds.
      // Other reasons may come with the range one (the server also checks the audio against
      // the transcoding profile), so only the founding bug's reason is asserted.
      const shown = `${item.name}: ${streamClass(item)}`;
      const reasons = decision.kind === "transcode" ? decision.reasons : [];
      expect({
        item: shown,
        kind: decision.kind,
        reasons: reasons.filter((reason) => reason === "VideoRangeTypeNotSupported"),
      }).toStrictEqual({
        item: onCorpus ? "Signal Tests S01E01: hevc DOVI P5 · eac3" : shown,
        kind: "transcode",
        reasons: ["VideoRangeTypeNotSupported"],
      });
    });

    it("omitting MaxStreamingBitrate transcodes a high-bitrate file for ContainerBitrateExceedsLimit", async () => {
      const { MaxStreamingBitrate: _profile, ...profile } = ours.DeviceProfile ?? {};
      const { MaxStreamingBitrate: _request, ...request } = ours;

      const item = pick(
        "sdr-h264-lpcm-bitrate",
        () => library.toSorted((a, b) => bitrate(b) - bitrate(a))[0],
        "item at all"
      );

      const decision = decide(
        await playbackInfo(session, item.id, { ...request, DeviceProfile: profile })
      );

      console.info(
        `[contract] no MaxStreamingBitrate, ${item.name} at ${(bitrate(item) / 1e6).toFixed(1)} Mbps: ${describeDecision(decision)}`
      );

      expect(decision.kind).toBe("transcode");
      expect(decision.kind === "transcode" ? decision.reasons : []).toContain(
        "ContainerBitrateExceedsLimit"
      );
    });
  });

  it("every Movie and Episode in the library direct plays", { timeout: 600_000 }, async () => {
    const started = performance.now();

    const verdicts = await mapLimit(library, 4, async (item) => ({
      item,
      decision: decide(await playbackInfo(session, item.id, ours)),
    }));

    const failures = verdicts
      .filter(({ decision }) => decision.kind !== "direct-play")
      .map(({ item, decision }) => {
        const unprobed = item.sources.every((source) => (source.MediaStreams?.length ?? 0) === 0);

        return `${item.name} [${item.path}]: ${describeDecision(decision)}${unprobed ? ", server has no stream info (its ffprobe failed)" : ""}`;
      });

    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.info(
      `[contract] sweep: ${verdicts.length} items, ${verdicts.length - failures.length} direct play, ${failures.length} not, ${seconds}s`
    );

    // Another library has no known size, so there only the failures count.
    expect(failures).toStrictEqual([]);
    expect(verdicts).toHaveLength(onCorpus ? corpus.entries.length : library.length);
  });
});
