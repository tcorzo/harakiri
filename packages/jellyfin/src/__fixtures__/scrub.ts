/**
 * Strips what a recorded Jellyfin response says about the library it came from: file paths and
 * names, item ids (the server derives them from the path), ETags, play sessions, attachment file
 * names, and the credits and release tags that track titles carry. Stream facts stay as recorded.
 * Both fixture recorders run their output through it, and a test checks every committed fixture
 * is already scrubbed. `scripts/lint-private.ts` catches what these rules cannot know about.
 */

import type { MediaSourceInfo, MediaStream, PlaybackInfoResponse } from "../generated/types.gen";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const present = <T>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined;

/** A stable 32-hex id for a seed: four FNV-1a hashes, so the same fixture always gets the same id. */
export const fakeHex = (seed: string): string =>
  [0x81_1c_9d_c5, 0x01_00_01_93, 0x05_0c_5d_1f, 0x6c_62_27_2e]
    .map((basis) => {
      let hash = basis;

      for (const char of seed) {
        // oxlint-disable-next-line eslint/no-bitwise -- FNV-1a is defined by this XOR
        hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01_00_01_93);
      }

      // oxlint-disable-next-line eslint/no-bitwise -- unsigned 32-bit view of the hash
      return (hash >>> 0).toString(16).padStart(8, "0");
    })
    .join("");

const dashed = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

// Free text in track titles that names people, encoders, dubbing studios or release groups.
const TEXT_RULES: [RegExp, string][] = [
  [/Commentary (?:by|with) .*?(?= - |$)/gu, "Commentary"],
  [/\s*\[(?![A-Z]{2}\])[^\]\s]+\]/gu, ""],
  [/^Encoded by \S+/u, "Main video"],
  [/^[^-[]+? \((?:19|20)\d{2}\)(?= - |$)/u, "Main video"],
  [/^(?<tag>MVO|AVO|DUB) \([^)]*\)/u, "$<tag>"],
];

/** A track title or display title with credits and release tags taken out. */
export const scrubText = (text: string): string => {
  let current = text;

  for (const [pattern, replacement] of TEXT_RULES) {
    current = current.replace(pattern, replacement);
  }

  return current;
};

const extension = (path: string) => /\.[^./]+$/u.exec(path)?.[0] ?? "";
const withoutExtension = (path: string) => path.slice(0, path.length - extension(path).length);

const scrubStream = (stream: MediaStream, base: string | undefined, file: string): MediaStream => {
  const next: Mutable<MediaStream> = { ...stream };

  if (present(next.Title)) {
    next.Title = scrubText(next.Title);
  }

  if (present(next.DisplayTitle)) {
    next.DisplayTitle = scrubText(next.DisplayTitle);
  }

  const { Path: path } = next;

  if (present(path)) {
    next.Path =
      base !== undefined && path.startsWith(base)
        ? `${file}${path.slice(base.length)}`
        : `${file}.${String(next.Index)}${extension(path)}`;
  }

  return next;
};

/** Replaces every spelling of `ids` (plain or dashed, any case) inside `value` with its fake. */
const replaceIds = <T>(value: T, ids: Map<string, string>): T => {
  let text = JSON.stringify(value);

  for (const [real, fake] of ids) {
    if (real === fake) {
      continue;
    }

    for (const [from, to] of [
      [real, fake],
      [dashed(real), dashed(fake)],
    ] as const) {
      text = text.replaceAll(
        new RegExp(from.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu"),
        to
      );
    }
  }

  // SAFETY: only id text is swapped for id text, so the JSON parses back to the same shape as `value`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse is untyped; the shape is `T`, see SAFETY
  return JSON.parse(text) as T;
};

const HEX32 = /^[0-9a-f]{32}$/iu;

/** A recorded MediaSource (full or trimmed) for the fixture `name`, with nothing left that names the library. */
export const scrubSource = (source: MediaSourceInfo, name: string): MediaSourceInfo => {
  const next: MediaSourceInfo = { ...source };
  const ids = new Map<string, string>();
  const file = `/media/movies/fixture-${name}`;
  const { Path: path } = next;
  const base = present(path) ? withoutExtension(path) : undefined;

  if (present(path)) {
    next.Path = `${file}${extension(path)}`;
  }

  if (present(next.Name)) {
    next.Name = `Fixture ${name}`;
  }

  if (present(next.Id) && HEX32.test(next.Id)) {
    ids.set(next.Id, fakeHex(`item ${name}`));
  }

  if (present(next.ETag)) {
    ids.set(next.ETag, fakeHex(`etag ${name}`));
  }

  if (present(next.MediaStreams)) {
    next.MediaStreams = next.MediaStreams.map((stream) => scrubStream(stream, base, file));
  }

  if (present(next.MediaAttachments)) {
    next.MediaAttachments = next.MediaAttachments.map((attachment, index) =>
      present(attachment.FileName)
        ? { ...attachment, FileName: `attachment-${index}${extension(attachment.FileName)}` }
        : attachment
    );
  }

  return replaceIds(next, ids);
};

/** A recorded PlaybackInfo response for the fixture `name`: its sources and its play session. */
export const scrubPlaybackInfo = (
  info: PlaybackInfoResponse,
  name: string
): PlaybackInfoResponse => {
  const next: PlaybackInfoResponse = { ...info };

  if (present(next.MediaSources)) {
    next.MediaSources = next.MediaSources.map((source, index) =>
      scrubSource(source, index === 0 ? name : `${name}-${index}`)
    );
  }

  const session = next.PlaySessionId;

  if (!present(session)) {
    return next;
  }

  return replaceIds(next, new Map([[session, fakeHex(`session ${name}`)]]));
};
