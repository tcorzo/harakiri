import {
  classifyFidelity,
  imageUrl as serverImageUrl,
  type Fidelity,
  ItemId,
  type ServerUrl,
} from "@harakiri/jellyfin";
import type { BaseItemDto, ImageType } from "@harakiri/jellyfin/generated";

import type { SignalState } from "../../../shared/bridge";

/**
 * One fact in a programme note. Only a fact harakiri changes on its way to the TV or receiver
 * carries a state (mapped, decoded); a native fact is stated bare, so the notes never read as a spec sheet.
 */
export interface NoteFact {
  readonly text: string;
  readonly state?: Exclude<SignalState, "native">;
}

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

export function kindOf(type: string | null | undefined): EntryKind {
  return kinds.find((kind) => kind === type) ?? "Other";
}

const asId = (raw: string): ItemId => ItemId.parse(raw);

function image(itemId: string | null | undefined, type: ImageType, tag: string | null | undefined) {
  return itemId == null || tag == null ? null : { itemId: asId(itemId), type, tag };
}

export function toEntry(item: BaseItemDto): Entry {
  const id = asId(item.Id ?? "");
  const kind = kindOf(item.Type);
  const tags = item.ImageTags ?? {};
  const user = item.UserData;
  const percent = user?.PlayedPercentage ?? null;
  const backdrop =
    image(id, "Backdrop", item.BackdropImageTags?.[0]) ??
    image(item.ParentBackdropItemId, "Backdrop", item.ParentBackdropImageTags?.[0]);
  return {
    id,
    kind,
    title: item.Name ?? "Untitled",
    year: item.ProductionYear ?? null,
    minutes: item.RunTimeTicks == null ? null : Math.round(item.RunTimeTicks / ticksPerMinute),
    overview: item.Overview ?? null,
    played: user?.Played ?? false,
    positionTicks: user?.PlaybackPositionTicks ?? 0,
    progress: percent !== null && percent > 0 && percent < 100 ? percent / 100 : null,
    series:
      item.SeriesId == null
        ? null
        : {
            id: asId(item.SeriesId),
            name: item.SeriesName ?? "",
            season: item.ParentIndexNumber ?? null,
            episode: item.IndexNumber ?? null,
          },
    unplayedCount: user?.UnplayedItemCount ?? null,
    backdrop,
    logo:
      image(id, "Logo", tags["Logo"]) ??
      image(item.ParentLogoItemId, "Logo", item.ParentLogoImageTag),
    poster:
      image(id, "Primary", tags["Primary"]) ??
      image(item.SeriesId, "Primary", item.SeriesPrimaryImageTag),
    still:
      kind === "Episode"
        ? image(id, "Primary", tags["Primary"])
        : (image(id, "Thumb", tags["Thumb"]) ?? backdrop),
    fidelity: classifyFidelity(item.MediaSources?.[0]),
  };
}

function fact(text: string, delivery: SignalState): NoteFact {
  const state = markedState(delivery);
  return state === undefined ? { text } : { text, state };
}

/** The programme note line: year · runtime · picture · sound; mapped and decoded facts carry their state. */
export function programmeNotes(
  entry: Entry,
  fidelity: Fidelity | null = entry.fidelity,
): NoteFact[] {
  const facts: NoteFact[] = [];
  if (entry.year !== null) facts.push({ text: String(entry.year) });
  if (entry.minutes !== null && entry.kind !== "Series")
    facts.push({ text: `${entry.minutes} min` });
  if (fidelity !== null) {
    const { picture, sound } = fidelity;
    facts.push(
      fact(
        [picture.resolution, picture.range].filter((part) => part !== null).join(" "),
        picture.delivery,
      ),
    );
    if (sound !== null) {
      const format = sound.format === "Other" ? sound.codec.toUpperCase() : sound.format;
      facts.push(
        fact([format, sound.channels].filter((part) => part !== null).join(" "), sound.delivery),
      );
    }
  }
  return facts;
}

export function episodeCode(entry: Entry): string | null {
  const s = entry.series;
  if (s === null || s.season === null || s.episode === null) return null;
  return `S${String(s.season).padStart(2, "0")} E${String(s.episode).padStart(2, "0")}`;
}

export function minutesLeft(entry: Entry): number | null {
  if (entry.progress === null || entry.minutes === null) return null;
  return Math.max(1, Math.round(entry.minutes * (1 - entry.progress)));
}

/** An image at the width it is shown, in device pixels. */
export function imageUrl(server: ServerUrl, ref: ImageRef, width: number): string {
  return serverImageUrl(server, ref.itemId, ref.type, {
    maxWidth: width,
    tag: ref.tag,
    quality: 90,
  });
}
