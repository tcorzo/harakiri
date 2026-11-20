import { ServerStatusError } from "../../../shared/errors";

export { ServerStatusError };

export type Failure =
  /** The server no longer accepts the token (401): sign in again, keeping the server. */
  | { readonly kind: "signedOut" }
  /** The token is good but the account may not do this (403): signing in again changes nothing. */
  | { readonly kind: "refused" }
  /** The server answered, with an error of its own. */
  | { readonly kind: "server"; readonly status: number }
  /** Nothing answered at all: the connection failed or timed out. */
  | { readonly kind: "unreachable" }
  /** Anything else, such as an answer that did not parse: the message is all there is to say. */
  | { readonly kind: "unexpected"; readonly message: string };

/**
 * The names a failed connection goes by: ky's own wrappers, the DOMException an aborted
 * `AbortSignal.timeout` raises, and Chromium's raw fetch failure when ky does not wrap it.
 */
const networkErrorNames: ReadonlySet<string> = new Set(["NetworkError", "TimeoutError"]);

const isNetworkFailure = (cause: unknown): boolean =>
  cause instanceof Error &&
  (networkErrorNames.has(cause.name) ||
    (cause.name === "TypeError" && cause.message === "Failed to fetch"));

export const classifyFailure = (cause: unknown): Failure => {
  if (cause instanceof ServerStatusError) {
    if (cause.status === 401) {
      return { kind: "signedOut" };
    }

    if (cause.status === 403) {
      return { kind: "refused" };
    }

    return { kind: "server", status: cause.status };
  }

  if (isNetworkFailure(cause)) {
    return { kind: "unreachable" };
  }

  return { kind: "unexpected", message: cause instanceof Error ? cause.message : String(cause) };
};
