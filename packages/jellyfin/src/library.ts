import { queryOptions } from "@tanstack/react-query";

import { classifyFidelity } from "./fidelity";
import { createClient } from "./generated/client";
import type { Client } from "./generated/client";
import {
  getEpisodes,
  getItem,
  getItems,
  getLatestMedia,
  getNextUp,
  getPublicSystemInfo,
  getPublicUsers,
  getResumeItems,
  getSeasons,
} from "./generated/sdk.gen";
import type { BaseItemDto, ImageType, PublicSystemInfo, UserDto } from "./generated/types.gen";
import type { ItemId, ServerUrl, UserId } from "./ids";

/** A signed-in client (see createJellyfinClient) and the user it acts for. */
export interface LibraryContext {
  readonly client: Client;
  readonly userId: UserId;
}

export interface ProgrammeSection {
  readonly id: string;
  readonly title: string;
  readonly items: readonly BaseItemDto[];
}

const HERO_POOL = 12;
const HERO_FILMS = 5;

const isHdr = (item: BaseItemDto): boolean =>
  (classifyFidelity(item.MediaSources?.[0])?.picture.range ?? "SDR") !== "SDR";

const ROW_LIMIT = 16;
const SECTION_COUNT = 6;
const SECTION_ITEMS = 20;

const POSTER: ImageType[] = ["Primary"];
const LANDSCAPE: ImageType[] = ["Primary", "Thumb", "Backdrop"];

/** Every library query key starts with this, so sign-out can drop them all at once. */
export const libraryRootKey = ({ client, userId }: LibraryContext) =>
  ["jellyfin", client.getConfig().baseUrl ?? "", userId] as const;

const key = <const T extends readonly unknown[]>(ctx: LibraryContext, ...rest: T) =>
  [...libraryRootKey(ctx), ...rest] as const;

// Random order is fixed for the life of the QueryClient: one programme per session.
export const heroQuery = (ctx: LibraryContext) =>
  queryOptions({
    queryKey: key(ctx, "hero"),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }): Promise<BaseItemDto[]> => {
      const { data } = await getItems({
        client: ctx.client,
        signal,
        throwOnError: true,
        query: {
          userId: ctx.userId,
          includeItemTypes: ["Movie"],
          recursive: true,
          imageTypes: ["Backdrop", "Logo"],
          enableImageTypes: ["Backdrop", "Logo"],
          imageTypeLimit: 1,
          fields: ["MediaSources"],
          sortBy: ["Random"],
          limit: HERO_POOL,
        },
      });

      const films = data.Items ?? [];

      return [...films.filter(isHdr), ...films.filter((item) => !isHdr(item))].slice(0, HERO_FILMS);
    },
  });

export const resumeQuery = (ctx: LibraryContext) =>
  queryOptions({
    queryKey: key(ctx, "resume"),
    queryFn: async ({ signal }): Promise<BaseItemDto[]> => {
      const { data } = await getResumeItems({
        client: ctx.client,
        signal,
        throwOnError: true,
        query: {
          userId: ctx.userId,
          mediaTypes: ["Video"],
          enableImageTypes: LANDSCAPE,
          imageTypeLimit: 1,
          limit: ROW_LIMIT,
        },
      });

      return data.Items ?? [];
    },
  });

export const nextUpQuery = (ctx: LibraryContext) =>
  queryOptions({
    queryKey: key(ctx, "next-up"),
    queryFn: async ({ signal }): Promise<BaseItemDto[]> => {
      const { data } = await getNextUp({
        client: ctx.client,
        signal,
        throwOnError: true,
        query: {
          userId: ctx.userId,
          enableImageTypes: LANDSCAPE,
          imageTypeLimit: 1,
          limit: ROW_LIMIT,
        },
      });

      return data.Items ?? [];
    },
  });

// Films and shows, not episodes: the server counts each episode against the limit
// before grouping them by series, so a batch of new episodes empties the row.
export const latestQuery = (ctx: LibraryContext) =>
  queryOptions({
    queryKey: key(ctx, "latest"),
    queryFn: async ({ signal }): Promise<BaseItemDto[]> => {
      const { data } = await getLatestMedia({
        client: ctx.client,
        signal,
        throwOnError: true,
        query: {
          userId: ctx.userId,
          includeItemTypes: ["Movie", "Series"],
          enableImageTypes: POSTER,
          imageTypeLimit: 1,
          limit: ROW_LIMIT,
        },
      });

      return data;
    },
  });

// Grouped from one /Items page rather than /Genres: the server fills its genre
// index only at the end of a library scan, while items carry Genres at once.
export const sectionsQuery = (ctx: LibraryContext) =>
  queryOptions({
    queryKey: key(ctx, "sections"),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }): Promise<ProgrammeSection[]> => {
      const { data } = await getItems({
        client: ctx.client,
        signal,
        throwOnError: true,
        query: {
          userId: ctx.userId,
          includeItemTypes: ["Movie", "Series"],
          recursive: true,
          fields: ["Genres"],
          enableImageTypes: POSTER,
          imageTypeLimit: 1,
          sortBy: ["Random"],
        },
      });

      const byGenre = new Map<string, BaseItemDto[]>();

      for (const item of data.Items ?? []) {
        for (const genre of item.Genres ?? []) {
          byGenre.set(genre, [...(byGenre.get(genre) ?? []), item]);
        }
      }

      return [...byGenre]
        .toSorted(([a, left], [b, right]) => right.length - left.length || a.localeCompare(b))
        .slice(0, SECTION_COUNT)
        .map(([genre, items]) => ({
          id: `genre:${genre}`,
          title: genre,
          items: items.slice(0, SECTION_ITEMS),
        }));
    },
  });

/** The full item: MediaSources, People, Overview and UserData come back by default. */
export const itemQuery = (ctx: LibraryContext, itemId: ItemId) =>
  queryOptions({
    queryKey: key(ctx, "item", itemId),
    queryFn: async ({ signal }): Promise<BaseItemDto> => {
      const { data } = await getItem({
        client: ctx.client,
        signal,
        throwOnError: true,
        path: { itemId },
        query: { userId: ctx.userId },
      });

      return data;
    },
  });

export const seasonsQuery = (ctx: LibraryContext, seriesId: ItemId) =>
  queryOptions({
    queryKey: key(ctx, "seasons", seriesId),
    queryFn: async ({ signal }): Promise<BaseItemDto[]> => {
      const { data } = await getSeasons({
        client: ctx.client,
        signal,
        throwOnError: true,
        path: { seriesId },
        query: { userId: ctx.userId, enableImageTypes: POSTER, imageTypeLimit: 1 },
      });

      return data.Items ?? [];
    },
  });

export const episodesQuery = (ctx: LibraryContext, seriesId: ItemId, seasonId: ItemId) =>
  queryOptions({
    queryKey: key(ctx, "episodes", seriesId, seasonId),
    queryFn: async ({ signal }): Promise<BaseItemDto[]> => {
      const { data } = await getEpisodes({
        client: ctx.client,
        signal,
        throwOnError: true,
        path: { seriesId },
        query: {
          userId: ctx.userId,
          seasonId,
          fields: ["Overview"],
          enableImageTypes: POSTER,
          imageTypeLimit: 1,
        },
      });

      return data.Items ?? [];
    },
  });

const anonymousClient = (server: ServerUrl): Client =>
  createClient({ baseUrl: server.replace(/\/$/u, "") });

export const publicUsersQuery = (server: ServerUrl) =>
  queryOptions({
    queryKey: ["jellyfin", server, "public-users"] as const,
    queryFn: async ({ signal }): Promise<UserDto[]> => {
      const { data } = await getPublicUsers({
        client: anonymousClient(server),
        signal,
        throwOnError: true,
      });

      return data;
    },
  });

// Validates a typed address. No retries: an unreachable server should say so at once.
export const serverInfoQuery = (server: ServerUrl) =>
  queryOptions({
    queryKey: ["jellyfin", server, "server-info"] as const,
    retry: false,
    queryFn: async ({ signal }): Promise<PublicSystemInfo> => {
      const { data } = await getPublicSystemInfo({
        client: anonymousClient(server),
        signal,
        throwOnError: true,
        retry: 0,
      });

      return data;
    },
  });
