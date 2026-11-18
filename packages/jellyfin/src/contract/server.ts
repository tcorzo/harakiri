/// <reference types="node" />
import type { Client } from "../generated/client";
import { getItems, getPostedPlaybackInfo, reportSessionEnded } from "../generated/sdk.gen";
import type {
  MediaSourceInfo,
  PlaybackInfoDto,
  PlaybackInfoResponse,
} from "../generated/types.gen";
import { DeviceId, ItemId, ServerUrl, type UserId } from "../ids";
import { authenticate, createJellyfinClient } from "../session";

export const SERVER = ServerUrl.parse(process.env["JELLYFIN_DEV_URL"] ?? "http://127.0.0.1:8096");
const USER = process.env["JELLYFIN_DEV_USER"] ?? "harakiri";
const PASSWORD = process.env["JELLYFIN_DEV_PASSWORD"] ?? "harakiri-dev";

export const serverUnreachable = async (): Promise<string | undefined> => {
  try {
    const response = await fetch(new URL("System/Info/Public", SERVER), {
      signal: AbortSignal.timeout(2000),
    });

    return response.ok ? undefined : `${SERVER} answered ${response.status}`;
  } catch (error) {
    return `${SERVER} is unreachable (${error instanceof Error ? error.message : String(error)})`;
  }
};

export type ContractSession = {
  readonly client: Client;
  readonly userId: UserId;
  readonly serverVersion: string;
  readonly end: () => Promise<void>;
};

// Jellyfin keeps one session per DeviceId; a shared id would revoke other agents' tokens.
export const signIn = async (): Promise<ContractSession> => {
  const identity = {
    client: "harakiri-contract",
    device: "vitest",
    deviceId: DeviceId.parse(`harakiri-contract-${crypto.randomUUID().slice(0, 8)}`),
    version: "0",
  };

  const result = await authenticate(SERVER, USER, PASSWORD, identity);

  if (result.kind !== "signed-in") throw new Error(`dev sign-in failed: ${JSON.stringify(result)}`);
  const client = createJellyfinClient(SERVER, identity, result.session.accessToken);
  client.setConfig({ timeout: 30_000, retry: 0 });

  return {
    client,
    userId: result.session.userId,
    serverVersion: result.session.serverVersion,
    end: async () => {
      await reportSessionEnded({ client });
    },
  };
};

export type LibraryItem = {
  readonly id: ItemId;
  readonly name: string;
  readonly type: "Movie" | "Episode";
  /** The file's path as the server sees it. */
  readonly path: string;
  readonly sources: readonly MediaSourceInfo[];
};

const label = (item: {
  Name?: string | null;
  Type?: string;
  SeriesName?: string | null;
  ParentIndexNumber?: number | null;
  IndexNumber?: number | null;
}): string => {
  if (item.Type !== "Episode") return item.Name ?? "?";
  const pad = (n: number | null | undefined) => String(n ?? 0).padStart(2, "0");

  return `${item.SeriesName} S${pad(item.ParentIndexNumber)}E${pad(item.IndexNumber)}`;
};

const PAGE = 200;

/** Every Movie and Episode that has a file, paged so one response stays near 3 MB. */
export const libraryItems = async ({
  client,
  userId,
}: Pick<ContractSession, "client" | "userId">): Promise<LibraryItem[]> => {
  const items: LibraryItem[] = [];

  for (let start = 0; ; start += PAGE) {
    const { data } = await getItems({
      client,
      throwOnError: true,
      query: {
        userId,
        recursive: true,
        includeItemTypes: ["Movie", "Episode"],
        fields: ["Path", "MediaSources"],
        sortBy: ["SortName"],
        startIndex: start,
        limit: PAGE,
      },
    });

    for (const item of data.Items ?? []) {
      const sources = item.MediaSources ?? [];

      if (sources.length === 0 || !item.Path) continue;
      items.push({
        id: ItemId.parse(item.Id),
        name: label(item),
        type: item.Type === "Episode" ? "Episode" : "Movie",
        path: item.Path,
        sources,
      });
    }

    if (start + PAGE >= (data.TotalRecordCount ?? 0)) return items;
  }
};

export const playbackInfo = async (
  { client }: ContractSession,
  itemId: ItemId,
  body: PlaybackInfoDto
): Promise<PlaybackInfoResponse> =>
  (await getPostedPlaybackInfo({ client, throwOnError: true, path: { itemId }, body })).data;

export type Decision =
  | { readonly kind: "direct-play"; readonly source: MediaSourceInfo }
  | { readonly kind: "transcode"; readonly reasons: readonly string[]; readonly url: string }
  | { readonly kind: "refused"; readonly detail: string };

/** The first source is what harakiri plays when it sends no MediaSourceId. */
export const decide = (response: PlaybackInfoResponse): Decision => {
  const sources = response.MediaSources ?? [];
  const transcoding = sources.find((source) => source.TranscodingUrl);

  if (transcoding?.TranscodingUrl) {
    const url = transcoding.TranscodingUrl;
    const reasons = new URL(url, SERVER).searchParams.get("TranscodeReasons");

    return { kind: "transcode", reasons: reasons ? reasons.split(",") : [], url };
  }

  const chosen = sources[0];

  if (chosen?.SupportsDirectPlay === true) return { kind: "direct-play", source: chosen };

  return {
    kind: "refused",
    detail:
      response.ErrorCode ??
      `${sources.length} sources, first SupportsDirectPlay=${chosen?.SupportsDirectPlay}`,
  };
};

export const describeDecision = (decision: Decision): string => {
  if (decision.kind === "direct-play") return "direct play";

  if (decision.kind === "transcode")
    return `transcode (${decision.reasons.join(",") || "no TranscodeReasons"})`;

  return `refused (${decision.detail})`;
};

export const mapLimit = async <T, R>(
  inputs: readonly T[],
  limit: number,
  run: (input: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = Array.from({ length: inputs.length });
  // One iterator shared by every worker hands each input to exactly one of them.
  const queue = inputs.entries();

  const worker = async () => {
    for (const [index, input] of queue) results[index] = await run(input);
  };

  await Promise.all(Array.from({ length: Math.min(limit, inputs.length) }, worker));

  return results;
};
