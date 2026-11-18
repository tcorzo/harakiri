import {
  episodesQuery as episodes,
  heroQuery,
  itemQuery as item,
  latestQuery,
  libraryRootKey,
  nextUpQuery,
  resumeQuery,
  seasonsQuery as seasons,
  sectionsQuery,
  type ItemId,
  type ProgrammeSection,
} from "@harakiri/jellyfin";
import { getEpisodes, getItems, type BaseItemDto } from "@harakiri/jellyfin/generated";
import { type QueryClient, queryOptions } from "@tanstack/react-query";

import { toEntry, type Entry } from "./entry";
import type { SignedIn } from "./session";

const entries = (items: readonly BaseItemDto[]): Entry[] => items.map(toEntry);

export interface Section {
  readonly id: string;
  readonly title: string;
  readonly entries: readonly Entry[];
}

const sections = (list: readonly ProgrammeSection[]): Section[] =>
  list.map((s) => ({ id: s.id, title: s.title, entries: entries(s.items) }));

export const featuredQuery = (ctx: SignedIn) =>
  queryOptions({ ...heroQuery(ctx), select: entries });

export const continueQuery = (ctx: SignedIn) =>
  queryOptions({ ...resumeQuery(ctx), select: entries });

export const upNextQuery = (ctx: SignedIn) =>
  queryOptions({ ...nextUpQuery(ctx), select: entries });

export const recentQuery = (ctx: SignedIn) =>
  queryOptions({ ...latestQuery(ctx), select: entries });

export const programmeQuery = (ctx: SignedIn) =>
  queryOptions({ ...sectionsQuery(ctx), select: sections });

const title = (raw: BaseItemDto) => ({ entry: toEntry(raw), item: raw });

export const titleQuery = (ctx: SignedIn, id: ItemId) =>
  queryOptions({ ...item(ctx, id), select: title });

export const seasonsQuery = (ctx: SignedIn, seriesId: ItemId) =>
  queryOptions({ ...seasons(ctx, seriesId), select: entries });

export const episodesQuery = (ctx: SignedIn, seriesId: ItemId, seasonId: ItemId) =>
  queryOptions({ ...episodes(ctx, seriesId, seasonId), select: entries });

/** The raw item query, for prefetching and invalidation where no mapping is wanted. */
export const rawItemQuery = item;

/** The episode after `episodeId` in its series, across seasons; null after the last one. */
export const nextEpisodeQuery = (ctx: SignedIn, seriesId: ItemId, episodeId: ItemId) =>
  queryOptions({
    queryKey: [...libraryRootKey(ctx), "next-episode", episodeId],
    staleTime: 0,
    queryFn: async ({ signal }): Promise<Entry | null> => {
      const { data } = await getEpisodes({
        client: ctx.client,
        signal,
        throwOnError: true,
        path: { seriesId },
        query: {
          userId: ctx.userId,
          startItemId: episodeId,
          limit: 2,
          enableImageTypes: ["Primary", "Thumb", "Backdrop"],
          imageTypeLimit: 1,
        },
      });

      const next = data.Items?.[1];

      return next === undefined ? null : toEntry(next);
    },
  });

/**
 * What a finished screening changed on the server: the item's resume point and played mark, the
 * rows built from them, and for an episode its series' counts. The hero, the catalogue and the
 * genre sections stay as they are, so the library the owner returns to has not reshuffled.
 */
export function playedKeys(ctx: SignedIn, entry: Entry): readonly (readonly unknown[])[] {
  const root = libraryRootKey(ctx);

  const keys: (readonly unknown[])[] = [
    item(ctx, entry.id).queryKey,
    [...root, "resume"],
    [...root, "next-up"],
    [...root, "next-episode"],
  ];

  if (entry.series !== null) {
    keys.push(
      item(ctx, entry.series.id).queryKey,
      [...root, "seasons", entry.series.id],
      [...root, "episodes", entry.series.id]
    );
  }

  return keys;
}

/**
 * Refetches what a screening changed once the server has stored it, on the player's `reported`
 * event for the item, which follows the stop report. The screen that played it is usually gone by
 * then (it hands the title page back as soon as mpv quits), so this listens on its own and stops
 * after that one event.
 */
export function refetchWhenReported(queryClient: QueryClient, ctx: SignedIn, entry: Entry): void {
  const keys = playedKeys(ctx, entry);

  const unsubscribe = window.harakiri.player.onEvent((event) => {
    if (event.itemId !== entry.id || event.phase !== "reported") {
      return;
    }
    unsubscribe();

    for (const queryKey of keys) {
      void queryClient.invalidateQueries({ queryKey });
    }
  });
}

/**
 * Every film and series id in accession order: the catalogue numbers. A title keeps its number
 * while the library only grows, because new arrivals are appended; removing a title renumbers the
 * ones added after it.
 */
export function catalogueQuery(ctx: SignedIn) {
  return queryOptions({
    queryKey: [...libraryRootKey(ctx), "catalogue"],
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }): Promise<ReadonlyMap<string, number>> => {
      const { data } = await getItems({
        client: ctx.client,
        signal,
        throwOnError: true,
        query: {
          userId: ctx.userId,
          recursive: true,
          includeItemTypes: ["Movie", "Series"],
          sortBy: ["DateCreated", "SortName"],
          sortOrder: ["Ascending"],
          enableImages: false,
          enableUserData: false,
        },
      });

      return new Map((data.Items ?? []).map((raw, i) => [raw.Id ?? "", i + 1]));
    },
  });
}
