/**
 * Strips what a recorded Jellyfin response says about the library it came from: file paths and
 * names, item ids (the server derives them from the path), ETags, play sessions, attachment file
 * names, and the credits and release tags that track titles carry. Stream facts stay as recorded.
 * Both fixture recorders run their output through it, and a test checks every committed fixture
 * is already scrubbed. `scripts/lint-private.ts` catches what these rules cannot know about.
 */

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A stable 32-hex id for a seed: four FNV-1a hashes, so the same fixture always gets the same id. */
export const fakeHex = (seed: string): string =>
  [0x81_1c_9d_c5, 0x01_00_01_93, 0x05_0c_5d_1f, 0x6c_62_27_2e]
    .map((basis) => {
      let hash = basis;

      for (const char of seed) {
        hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01_00_01_93);
      }

      return (hash >>> 0).toString(16).padStart(8, "0");
    })
    .join("");

const dashed = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

// Free text in track titles that names people, encoders, dubbing studios or release groups.
const TEXT_RULES: [RegExp, string][] = [
  [/Commentary (?:by|with) .*?(?= - |$)/g, "Commentary"],
  [/\s*\[(?![A-Z]{2}\])[^\]\s]+\]/g, ""],
  [/^Encoded by \S+/, "Main video"],
  [/^[^-[]+? \((?:19|20)\d{2}\)(?= - |$)/, "Main video"],
  [/^(MVO|AVO|DUB) \([^)]*\)/, "$1"],
];

/** A track title or display title with credits and release tags taken out. */
export const scrubText = (text: string): string =>
  TEXT_RULES.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text
  );

const extension = (path: string) => /\.[^./]+$/.exec(path)?.[0] ?? "";
const withoutExtension = (path: string) => path.slice(0, path.length - extension(path).length);

const scrubStream = (stream: unknown, base: string | undefined, file: string): unknown => {
  if (!isRecord(stream)) {
    return stream;
  }
  const next: Json = { ...stream };

  for (const key of ["Title", "DisplayTitle"]) {
    if (typeof next[key] === "string") next[key] = scrubText(next[key]);
  }
  const path = next.Path;

  if (typeof path === "string") {
    next.Path =
      base !== undefined && path.startsWith(base)
        ? `${file}${path.slice(base.length)}`
        : `${file}.${String(next.Index)}${extension(path)}`;
  }

  return next;
};

/** Replaces every spelling of `ids` (plain or dashed, any case) inside `value` with its fake. */
const replaceIds = (value: unknown, ids: Map<string, string>): unknown => {
  let text = JSON.stringify(value);

  for (const [real, fake] of ids) {
    if (real === fake) {
      continue;
    }

    for (const [from, to] of [
      [real, fake],
      [dashed(real), dashed(fake)],
    ] as const) {
      text = text.replaceAll(new RegExp(from.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), to);
    }
  }

  const parsed: unknown = JSON.parse(text);

  return parsed;
};

const HEX32 = /^[0-9a-f]{32}$/i;

/** A recorded MediaSource (full or trimmed) for the fixture `name`, with nothing left that names the library. */
export const scrubSource = (source: Json, name: string): Json => {
  const next: Json = { ...source };
  const ids = new Map<string, string>();
  const file = `/media/movies/fixture-${name}`;
  const path = typeof next.Path === "string" ? next.Path : undefined;
  const base = path === undefined ? undefined : withoutExtension(path);

  if (path !== undefined) {
    next.Path = `${file}${extension(path)}`;
  }

  if (typeof next.Name === "string") {
    next.Name = `Fixture ${name}`;
  }

  if (typeof next.Id === "string" && HEX32.test(next.Id)) {
    ids.set(next.Id, fakeHex(`item ${name}`));
  }

  if (typeof next.ETag === "string") {
    ids.set(next.ETag, fakeHex(`etag ${name}`));
  }

  if (Array.isArray(next.MediaStreams)) {
    next.MediaStreams = next.MediaStreams.map((stream) => scrubStream(stream, base, file));
  }

  if (Array.isArray(next.MediaAttachments)) {
    next.MediaAttachments = next.MediaAttachments.map((attachment, index) =>
      isRecord(attachment) && typeof attachment.FileName === "string"
        ? { ...attachment, FileName: `attachment-${index}${extension(attachment.FileName)}` }
        : attachment
    );
  }
  const scrubbed = replaceIds(next, ids);

  return isRecord(scrubbed) ? scrubbed : next;
};

/** A recorded PlaybackInfo response for the fixture `name`: its sources and its play session. */
export const scrubPlaybackInfo = (info: Json, name: string): Json => {
  const next: Json = { ...info };

  if (Array.isArray(next.MediaSources)) {
    next.MediaSources = next.MediaSources.map((source, index) =>
      isRecord(source) ? scrubSource(source, index === 0 ? name : `${name}-${index}`) : source
    );
  }
  const session = next.PlaySessionId;

  if (typeof session !== "string") {
    return next;
  }
  const scrubbed = replaceIds(next, new Map([[session, fakeHex(`session ${name}`)]]));

  return isRecord(scrubbed) ? scrubbed : next;
};
