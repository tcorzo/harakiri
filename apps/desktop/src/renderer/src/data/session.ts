import { createJellyfinClient, type LibraryContext, type ServerUrl } from "@harakiri/jellyfin";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";

import type { Session } from "../../../shared/bridge";
import { clientIdentity } from "../../../shared/identity";
import { ServerStatusError } from "./errors";

export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: () => window.harakiri.session.get(),
  staleTime: Infinity,
});

/** The signed-in library context plus the parsed server URL, built once per session. */
export interface SignedIn extends LibraryContext {
  readonly server: ServerUrl;
  readonly session: Session;
}

const contexts = new WeakMap<Session, SignedIn>();

export function signedIn(session: Session): SignedIn {
  let context = contexts.get(session);

  if (context === undefined) {
    const client = createJellyfinClient(
      session.serverUrl,
      clientIdentity(session.deviceId),
      session.accessToken
    );

    // ky 2 consumes an error response's body before the generated client reads it, so a failed
    // request surfaces as "body already used" with the status lost. Raise the status here, as the
    // response arrives, so a revoked token (401) reads as signed out, not as a dead server.
    client.interceptors.response.use((response) => {
      if (!response.ok) {
        throw new ServerStatusError(response.status, response.url);
      }

      return response;
    });
    context = { server: session.serverUrl, session, userId: session.userId, client };
    contexts.set(session, context);
  }

  return context;
}

/** Only rendered under the signed-in layout, which redirects to onboarding when there is no session. */
export function useSignedIn(): SignedIn {
  const { data } = useSuspenseQuery(sessionQuery);

  if (data === null) {
    throw new Error("useSignedIn outside the signed-in layout");
  }

  return signedIn(data);
}
