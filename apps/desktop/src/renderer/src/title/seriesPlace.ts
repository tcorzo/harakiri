import type { ItemId } from "@harakiri/jellyfin";

/** The season and episode the owner last had on a series page, so returning lands back there. */
export interface SeriesPlace {
  readonly season: ItemId;
  readonly episode: ItemId | null;
}

const places = new Map<ItemId, SeriesPlace>();

export const seriesPlace = {
  get: (series: ItemId): SeriesPlace | undefined => places.get(series),
  set: (series: ItemId, place: SeriesPlace): void => {
    places.set(series, place);
  },
  clear: (): void => {
    places.clear();
  },
};
