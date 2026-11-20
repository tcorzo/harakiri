// Shared Jellyfin dev-server helpers for bootstrap.ts and wait-scan.ts. fetch only, no deps.
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const BASE =
  process.env.JELLYFIN_DEV_URL ?? `http://127.0.0.1:${process.env.JELLYFIN_DEV_PORT ?? "8096"}`;

export const USER = process.env.JELLYFIN_DEV_USER ?? "harakiri";
export const PASSWORD = process.env.JELLYFIN_DEV_PASSWORD ?? "harakiri-dev";

const isBlank = (value: string | undefined) => value === undefined || value === "";

export const USING_DEFAULT_CREDS =
  isBlank(process.env.JELLYFIN_DEV_USER) || isBlank(process.env.JELLYFIN_DEV_PASSWORD);

// Jellyfin keeps one session per DeviceId: a new login revokes the previous token for the same id.
// A per-script id lets bootstrap.ts and a running wait-scan.ts coexist without logging each other out.
const SCRIPT = path.basename(process.argv[1] ?? "script", ".ts");
const CLIENT_AUTH = `MediaBrowser Client="harakiri-dev", Device="${SCRIPT}", DeviceId="harakiri-dev-${SCRIPT}", Version="0"`;

// Jellyfin answers every route 503 ("Jellyfin Server is loading") while it starts, so a call that
// races the end of startup waits for it instead of failing a first-run bootstrap.
const UNAVAILABLE_RETRY_MS = 60_000;

export const api = async <T = unknown>(
  method: string,
  route: string,
  opts: { token?: string; body?: unknown } = {}
): Promise<T> => {
  const auth = isBlank(opts.token) ? CLIENT_AUTH : `${CLIENT_AUTH}, Token="${opts.token}"`;

  const headers = new Headers({ Authorization: auth });

  if (opts.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const send = async () =>
    await fetch(BASE + route, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });

  const deadline = Date.now() + UNAVAILABLE_RETRY_MS;
  let res = await send();

  if (res.status === 503) {
    console.log(`${method} ${route} -> 503, server still starting; retrying`);
  }

  /* oxlint-disable eslint/no-await-in-loop -- retries are sequential: each waits out the previous 503 */
  while (res.status === 503 && Date.now() < deadline) {
    await res.body?.cancel();
    await sleep(1000);
    res = await send();
  }
  /* oxlint-enable eslint/no-await-in-loop */

  if (!res.ok) {
    throw new Error(`${method} ${route} -> ${res.status} ${await res.text().catch(() => "")}`);
  }

  const text = await res.text();

  /* oxlint-disable typescript/no-unsafe-type-assertion -- dev-only helper with no zod in reach (dev/ is outside the workspaces); each caller declares the documented response shape of the pinned Jellyfin 12.4 and a mismatch fails at first use */
  // SAFETY: the caller's T is the documented response shape of the endpoint it called; an empty body is the no-content case.
  return (text === "" ? undefined : JSON.parse(text)) as T;
  /* oxlint-enable typescript/no-unsafe-type-assertion */
};

interface PublicInfo {
  StartupWizardCompleted: boolean;
  Version?: string;
}

export const waitForServer = async (
  timeoutMs = 180_000
): Promise<{ StartupWizardCompleted: boolean; Version: string }> => {
  const deadline = Date.now() + timeoutMs;
  let last = "";

  /* oxlint-disable eslint/no-await-in-loop -- readiness polling is sequential by nature */
  while (Date.now() < deadline) {
    try {
      // While a fresh server starts, a transient host answers 200 in camelCase ("version"), then
      // drops connections and answers 503; only the real server answers with "Version".
      const info = await api<PublicInfo | undefined>("GET", "/System/Info/Public");

      if (info?.Version !== undefined) {
        return { StartupWizardCompleted: info.StartupWizardCompleted, Version: info.Version };
      }

      last = `not started yet: ${JSON.stringify(info)?.slice(0, 120)}`;
    } catch (error) {
      last = String(error);
    }

    await sleep(2000);
  }
  /* oxlint-enable eslint/no-await-in-loop */

  throw new Error(`server at ${BASE} not ready after ${timeoutMs}ms: ${last}`);
};

export const login = async (): Promise<{ token: string; userId: string }> => {
  const r = await api<{ AccessToken: string; User: { Id: string } }>(
    "POST",
    "/Users/AuthenticateByName",
    {
      body: { Username: USER, Pw: PASSWORD },
    }
  );

  return { token: r.AccessToken, userId: r.User.Id };
};
