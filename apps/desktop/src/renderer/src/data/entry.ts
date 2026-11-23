import { classifyFidelity, imageUrl as serverImageUrl, ItemId } from "@harakiri/jellyfin";
import type { Fidelity, PictureClass, ServerUrl, SoundFormat } from "@harakiri/jellyfin";
import type { BaseItemDto, ImageType } from "@harakiri/jellyfin/generated";

import type { SignalState } from "../../../shared/bridge";

/**
 * One fact in a programme note. Only a fact harakiri changes on its way to the TV or receiver
 * carries a state (mapped, decoded); a native fact is stated bare, so the notes never read as a spec sheet.
 */
export interface NoteFact {
  /** The whole fact in words: its key, and what assistive tech reads. */
  readonly text: string;
  readonly state?: Exclude<SignalState, "native">;
  /** How the fact is drawn: the format's own logo where it has one, words for the rest. */
  readonly parts?: readonly NotePart[];
}

/** A picture or sound format drawn as its own logo. */
export type FormatLogo =
  | "dolby-vision"
  | "hdr10"
  | "hdr10-plus"
  | "dolby-atmos"
  | "dolby-truehd"
  | "dolby-digital-plus"
  | "dolby-digital"
  | "dts";

export type NotePart = { readonly text: string } | { readonly logo: FormatLogo };

/** The note state for a delivery: native facts carry none. */
export const markedState = (state: SignalState): NoteFact["state"] =>
  state === "native" ? undefined : state;

export interface ImageRef {
  readonly itemId: ItemId;
  readonly type: ImageType;
  readonly tag: string;
}

/** "Other" is anything else the server lists (a video, a box set): shown, but never assumed to be a film. */
export type EntryKind = "Movie" | "Series" | "Season" | "Episode" | "Other";

/** A title as the programme lists it: what the screens show, parsed once from the server's item. */
export interface Entry {
  readonly id: ItemId;
  readonly kind: EntryKind;
  readonly title: string;
  readonly year: number | null;
  readonly minutes: number | null;
  readonly overview: string | null;
  readonly played: boolean;
  readonly positionTicks: number;
  /** 0 to 1 when partly watched. */
  readonly progress: number | null;
  readonly series: {
    readonly id: ItemId;
    readonly name: string;
    readonly season: number | null;
    readonly episode: number | null;
  } | null;
  readonly unplayedCount: number | null;
  readonly backdrop: ImageRef | null;
  readonly logo: ImageRef | null;
  readonly poster: ImageRef | null;
  readonly still: ImageRef | null;
  readonly fidelity: Fidelity | null;
}

const ticksPerMinute = 600_000_000;

const kinds: readonly EntryKind[] = ["Movie", "Series", "Season", "Episode"];

export const kindOf = (type: string | null | undefined): EntryKind =>
  kinds.find((kind) => kind === type) ?? "Other";

const asId = (raw: string): ItemId => ItemId.parse(raw);

const image = (
  itemId: string | null | undefined,
  type: ImageType,
  tag: string | null | undefined
) =>
  itemId === undefined || itemId === null || tag === undefined || tag === null
    ? null
    : { itemId: asId(itemId), type, tag };

const minutesOf = (ticks: number | null | undefined): number | null =>
  ticks === undefined || ticks === null ? null : Math.round(ticks / ticksPerMinute);

const progressOf = (percent: number | null): number | null =>
  percent !== null && percent > 0 && percent < 100 ? percent / 100 : null;

const seriesOf = (item: BaseItemDto): Entry["series"] =>
  item.SeriesId === undefined || item.SeriesId === null
    ? null
    : {
        id: asId(item.SeriesId),
        name: item.SeriesName ?? "",
        season: item.ParentIndexNumber ?? null,
        episode: item.IndexNumber ?? null,
      };

const artworkOf = (item: BaseItemDto, id: ItemId, kind: EntryKind) => {
  const tags = item.ImageTags ?? {};

  const backdrop =
    image(id, "Backdrop", item.BackdropImageTags?.[0]) ??
    image(item.ParentBackdropItemId, "Backdrop", item.ParentBackdropImageTags?.[0]);

  return {
    backdrop,
    logo:
      image(id, "Logo", tags.Logo) ?? image(item.ParentLogoItemId, "Logo", item.ParentLogoImageTag),
    poster:
      image(id, "Primary", tags.Primary) ??
      image(item.SeriesId, "Primary", item.SeriesPrimaryImageTag),
    still:
      kind === "Episode"
        ? image(id, "Primary", tags.Primary)
        : (image(id, "Thumb", tags.Thumb) ?? backdrop),
  };
};

export const toEntry = (item: BaseItemDto): Entry => {
  const id = asId(item.Id ?? "");
  const kind = kindOf(item.Type);
  const user = item.UserData;
  const percent = user?.PlayedPercentage ?? null;

  return {
    id,
    kind,
    title: item.Name ?? "Untitled",
    year: item.ProductionYear ?? null,
    minutes: minutesOf(item.RunTimeTicks),
    overview: item.Overview ?? null,
    played: user?.Played ?? false,
    positionTicks: user?.PlaybackPositionTicks ?? 0,
    progress: progressOf(percent),
    series: seriesOf(item),
    unplayedCount: user?.UnplayedItemCount ?? null,
    ...artworkOf(item, id, kind),
    fidelity: classifyFidelity(item.MediaSources?.[0]),
  };
};

/** The picture ranges and sound formats drawn as their own logos; the rest stay words. */
const rangeLogos: Record<PictureClass["range"], readonly NotePart[] | null> = {
  "Dolby Vision": [{ logo: "dolby-vision" }],
  HDR10: [{ logo: "hdr10" }],
  "HDR10+": [{ logo: "hdr10-plus" }],
  HLG: null,
  SDR: null,
};

// DTS-HD names its tier in words beside the DTS logo: its own stacked logo cannot be read this small.
const soundLogos: Record<SoundFormat, readonly NotePart[] | null> = {
  "TrueHD Atmos": [{ logo: "dolby-truehd" }, { logo: "dolby-atmos" }],
  TrueHD: [{ logo: "dolby-truehd" }],
  "DTS:X": null,
  "DTS-HD MA": [{ logo: "dts" }, { text: "HD MA" }],
  "DTS-HD HRA": [{ logo: "dts" }, { text: "HD HRA" }],
  DTS: [{ logo: "dts" }],
  "E-AC3 Atmos": [{ logo: "dolby-digital-plus" }, { logo: "dolby-atmos" }],
  "E-AC3": [{ logo: "dolby-digital-plus" }],
  AC3: [{ logo: "dolby-digital" }],
  PCM: null,
  FLAC: null,
  Opus: null,
  AAC: null,
  Other: null,
};

/** The logos for a segment, or its words when it has none. */
const drawn = (logos: readonly NotePart[] | null, words: string): readonly NotePart[] =>
  logos ?? [{ text: words }];

/** Drops missing segments and joins neighbouring words into one part. */
const partsOf = (segments: readonly (NotePart | null)[]): NotePart[] => {
  const parts: NotePart[] = [];

  for (const part of segments) {
    if (part === null) {
      continue;
    }

    const last = parts.at(-1);

    if ("text" in part && last !== undefined && "text" in last) {
      parts[parts.length - 1] = { text: `${last.text} ${part.text}` };
    } else {
      parts.push(part);
    }
  }

  return parts;
};

const fact = (
  words: readonly (string | null)[],
  delivery: SignalState,
  segments: readonly (NotePart | null)[]
): NoteFact => {
  const state = markedState(delivery);
  const text = words.filter((word) => word !== null).join(" ");
  const parts = partsOf(segments);

  return state === undefined ? { text, parts } : { text, state, parts };
};

/** The programme note line: year · runtime · picture · sound; mapped and decoded facts carry their state. */
export const programmeNotes = (
  entry: Entry,
  fidelity: Fidelity | null = entry.fidelity
): NoteFact[] => {
  const facts: NoteFact[] = [];

  if (entry.year !== null) {
    facts.push({ text: String(entry.year) });
  }

  if (entry.minutes !== null && entry.kind !== "Series") {
    facts.push({ text: `${entry.minutes} min` });
  }

  if (fidelity !== null) {
    const { picture, sound } = fidelity;
    facts.push(
      fact([picture.resolution, picture.range], picture.delivery, [
        picture.resolution === null ? null : { text: picture.resolution },
        ...drawn(rangeLogos[picture.range], picture.range),
      ])
    );

    if (sound !== null) {
      const format = sound.format === "Other" ? sound.codec.toUpperCase() : sound.format;
      facts.push(
        fact([format, sound.channels], sound.delivery, [
          ...drawn(soundLogos[sound.format], format),
          sound.channels === null ? null : { text: sound.channels },
        ])
      );
    }
  }

  return facts;
};

export const episodeCode = (entry: Entry): string | null => {
  const s = entry.series;

  if (s === null || s.season === null || s.episode === null) {
    return null;
  }

  return `S${String(s.season).padStart(2, "0")} E${String(s.episode).padStart(2, "0")}`;
};

export const minutesLeft = (entry: Entry): number | null => {
  if (entry.progress === null || entry.minutes === null) {
    return null;
  }

  return Math.max(1, Math.round(entry.minutes * (1 - entry.progress)));
};

/** An image at the width it is shown, in device pixels. */
export const imageUrl = (server: ServerUrl, ref: ImageRef, width: number): string =>
  serverImageUrl(server, ref.itemId, ref.type, {
    maxWidth: width,
    tag: ref.tag,
    quality: 90,
  });
