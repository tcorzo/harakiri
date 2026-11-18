import {
  authenticate,
  authenticateWithQuickConnect,
  initiateQuickConnect,
  pollQuickConnect,
  quickConnectEnabled as serverQuickConnectEnabled,
  serverInfoQuery,
  ServerUrl,
} from "@harakiri/jellyfin";
import type { ClientIdentity, SignInResult } from "@harakiri/jellyfin";
import type { QueryClient } from "@tanstack/react-query";
import { match } from "ts-pattern";

import type { Session } from "../../../shared/bridge";
import { isServerSupported } from "./machine";
import type { ServerInfo, ServerProblem, SignInProblem } from "./machine";

export type Checked =
  | { readonly ok: true; readonly info: ServerInfo }
  | { readonly ok: false; readonly problem: ServerProblem };

/**
 * Checks every candidate URL at once. The first that answers as a supported Jellyfin wins, so a
 * firewalled candidate costs nothing when another answers. When none does, the problem from a
 * candidate that answered at all says more than "unreachable".
 */
export async function checkServer(
  queryClient: QueryClient,
  urls: readonly string[]
): Promise<Checked> {
  const checks = urls.map((url) => checkOne(queryClient, url));

  try {
    return await Promise.any(
      checks.map(async (check) => {
        const result = await check;

        if (!result.ok) {
          throw new Error(result.problem.kind);
        }

        return result;
      })
    );
  } catch {
    const failed = await Promise.all(checks);

    return failed.find((r) => !r.ok && r.problem.kind !== "unreachable") ?? failed[0] ?? invalid;
  }
}

const invalid: Checked = { ok: false, problem: { kind: "invalid" } };

/** Validates a server with `GET /System/Info/Public`, the only endpoint that needs no sign-in. */
async function checkOne(queryClient: QueryClient, url: string): Promise<Checked> {
  const server = ServerUrl.safeParse(url);

  if (!server.success) {
    return invalid;
  }
  let info;

  try {
    info = await queryClient.fetchQuery({ ...serverInfoQuery(server.data), staleTime: 0 });
  } catch (error) {
    // Only a failed or timed-out connection is unreachable: ky 2 raises those as NetworkError and
    // TimeoutError. An HTTP error status arrives as anything else (ky has already consumed the
    // body, so the generated client fails re-reading it), and means something answered.
    const unreachable =
      error instanceof Error && (error.name === "NetworkError" || error.name === "TimeoutError");

    return { ok: false, problem: { kind: unreachable ? "unreachable" : "notJellyfin" } };
  }

  if (info.Id == null || info.Version == null || !/jellyfin/i.test(info.ProductName ?? "")) {
    return { ok: false, problem: { kind: "notJellyfin" } };
  }

  if (!isServerSupported(info.Version)) {
    return { ok: false, problem: { kind: "tooOld", version: info.Version } };
  }

  return {
    ok: true,
    info: {
      url: server.data,
      id: info.Id,
      name: info.ServerName ?? "Jellyfin",
      version: info.Version,
    },
  };
}

export type SignedInResult =
  | { readonly ok: true; readonly session: Session }
  | { readonly ok: false; readonly problem: SignInProblem };

function outcome(result: SignInResult): SignedInResult {
  return match<SignInResult, SignedInResult>(result)
    .with({ kind: "signed-in" }, (r) => ({ ok: true, session: r.session }))
    .with({ kind: "wrong-credentials" }, () => ({ ok: false, problem: "wrongPassword" }))
    .with({ kind: "rejected" }, () => ({ ok: false, problem: "rejected" }))
    .with({ kind: "unreachable" }, () => ({ ok: false, problem: "unreachable" }))
    .exhaustive();
}

export async function signIn(
  server: ServerInfo,
  identity: ClientIdentity,
  username: string,
  password: string
): Promise<SignedInResult> {
  return outcome(await authenticate(ServerUrl.parse(server.url), username, password, identity));
}

export async function quickConnectEnabled(
  server: ServerInfo,
  identity: ClientIdentity
): Promise<boolean> {
  try {
    return await serverQuickConnectEnabled(ServerUrl.parse(server.url), identity);
  } catch {
    return false;
  }
}

export type QuickConnectOutcome =
  | { readonly kind: "code"; readonly code: string }
  | { readonly kind: "signedIn"; readonly session: Session }
  | { readonly kind: "failed"; readonly problem: "disabled" | "expired" | "unreachable" };

/**
 * Asks for a code, reports it, then polls until the owner approves it from a signed-in device.
 * Jellyfin forgets an unapproved code after a few minutes; the poll then fails and reads as expired.
 */
export async function runQuickConnect(
  server: ServerInfo,
  identity: ClientIdentity,
  signal: AbortSignal,
  report: (outcome: QuickConnectOutcome) => void,
  intervalMs = 3000
): Promise<void> {
  const url = ServerUrl.parse(server.url);
  let secret: string;

  try {
    const started = await initiateQuickConnect(url, identity);
    secret = started.secret;
    report({ kind: "code", code: started.code });
  } catch {
    report({ kind: "failed", problem: "disabled" });

    return;
  }

  while (!signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    if (signal.aborted) {
      return;
    }
    let approved: boolean;

    try {
      approved = await pollQuickConnect(url, identity, secret);
    } catch {
      report({ kind: "failed", problem: "expired" });

      return;
    }

    if (approved) {
      const result = outcome(await authenticateWithQuickConnect(url, identity, secret));
      report(
        result.ok
          ? { kind: "signedIn", session: result.session }
          : { kind: "failed", problem: "unreachable" }
      );

      return;
    }
  }
}
