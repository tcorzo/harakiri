import {
  queryOptions,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { match } from "ts-pattern";

import type { LauncherAddResult, LauncherStatus } from "../../../shared/bridge";

/**
 * Whether harakiri can be added to the game launcher. An add refetches it, so the library's card
 * reads it once and keeps the cached value its focus depends on. Signing out clears the cache
 * (`data/forget.ts`).
 */
export const launcherStatusQuery = queryOptions({
  queryKey: ["launcher", "status"] as const,
  queryFn: async () => await window.harakiri.launcher.status(),
  staleTime: Infinity,
});

/**
 * The status as Settings shows it: read again each time Settings opens, because the owner can
 * remove harakiri from the launcher while harakiri runs.
 */
export const useLauncherStatusOnOpen = (): UseQueryResult<LauncherStatus> =>
  useQuery({ ...launcherStatusQuery, refetchOnMount: "always" });

const addKey = ["launcher", "add"] as const;

/** Adds harakiri to the launcher; once it settles the status is read again. */
export const useAddToLauncher = (): UseMutationResult<LauncherAddResult, Error, void> => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: addKey,
    mutationFn: async () => await window.harakiri.launcher.add(),
    // Awaited, so the caller's own callbacks run once the status has been read again.
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: launcherStatusQuery.queryKey });
    },
  });
};

/**
 * Whether an add is under way anywhere: one started on the library's card still shows, and still
 * holds off a second add, in Settings.
 */
export const useAddingToLauncher = (): boolean => useIsMutating({ mutationKey: addKey }) > 0;

/** What the add came to, with a rejected call read as a failure that names its reason. */
export const addResultOf = (
  add: UseMutationResult<LauncherAddResult, Error, void>
): LauncherAddResult | undefined =>
  add.error === null ? add.data : { state: "failed", reason: add.error.message };

/** A launcher harakiri can be added to, with the words main sends for it. */
export type OfferedLauncher = Extract<LauncherStatus, { readonly state: "offered" }>;

/** The line to show under the action for a result, or null when there is nothing to say. */
export const addOutcomeLine = (
  { name, retryHint }: OfferedLauncher,
  result: LauncherAddResult | undefined,
  pending: boolean
): string | null => {
  if (pending) {
    return `Adding to ${name}…`;
  }

  if (result === undefined) {
    return null;
  }

  return match(result)
    .with({ state: "added" }, () => null)
    .with({ state: "timedOut" }, () => `${name} did not list harakiri in time. ${retryHint}`)
    .with({ state: "failed" }, ({ reason }) => `Could not add harakiri to ${name}: ${reason}`)
    .exhaustive();
};

/** Whether the line for a result reports a problem, so it leads with the problem mark. */
export const isProblem = (result: LauncherAddResult | undefined, pending: boolean): boolean =>
  !pending && result !== undefined && result.state !== "added";
