import { reportSessionEnded } from "@harakiri/jellyfin/generated";
import type { QueryClient } from "@tanstack/react-query";

import { useLit } from "../library/lit";
import { seriesPlace } from "../title/seriesPlace";
import { sessionQuery, signedIn } from "./session";

/**
 * Signs out on this device: the session, every cached answer, and everything the screens remember
 * about the old server (the lit entry, the place in the rows, the hero, series places), so the next
 * server never opens on the last one's state. The device id stays.
 *
 * With `revoke`, the server is asked to revoke the token first; a dead or unreachable server must
 * not keep the owner signed in, so that is best effort. A token the server already refused (401)
 * is not sent again.
 */
export async function forgetSession(
  queryClient: QueryClient,
  { revoke }: { readonly revoke: boolean }
): Promise<void> {
  const session = queryClient.getQueryData(sessionQuery.queryKey);
  if (session && revoke) {
    await reportSessionEnded({
      client: signedIn(session).client,
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  }
  await window.harakiri.session.clear();
  useLit.getState().forget();
  seriesPlace.clear();
  queryClient.clear();
  queryClient.setQueryData(sessionQuery.queryKey, null);
}
