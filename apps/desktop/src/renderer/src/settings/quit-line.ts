import { queryOptions } from "@tanstack/react-query";
import { match, P } from "ts-pattern";

import type { UpdateStatus } from "../../../shared/bridge";

/** What the updater is doing. Unsupported means a dev or unpackaged build: nothing will change, so stop asking. */
export const updateStatusQuery = queryOptions({
  queryKey: ["updates", "status"] as const,
  queryFn: async () => await window.harakiri.updates.status(),
  refetchInterval: (query) => (query.state.data?.state === "unsupported" ? false : 1000),
});

/** The detail under Quit harakiri: quitting installs an update that is ready. */
export const quitLine = (status: UpdateStatus | undefined): string =>
  match(status)
    .with({ state: "ready" }, (s) => `Installs ${s.version} as it closes`)
    .with(P._, () => "Closes the app")
    .exhaustive();
