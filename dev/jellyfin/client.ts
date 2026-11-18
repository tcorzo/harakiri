// Shared Jellyfin dev-server helpers for bootstrap.ts and wait-scan.ts. fetch only, no deps.

export const BASE =
  process.env.JELLYFIN_DEV_URL ?? `http://127.0.0.1:${process.env.JELLYFIN_DEV_PORT ?? "8096"}`;

export const USER = process.env.JELLYFIN_DEV_USER ?? "harakiri";
export const PASSWORD = process.env.JELLYFIN_DEV_PASSWORD ?? "harakiri-dev";

export const USING_DEFAULT_CREDS =
  !process.env.JELLYFIN_DEV_USER || !process.env.JELLYFIN_DEV_PASSWORD;

// Jellyfin keeps one session per DeviceId: a new login revokes the previous token for the same id.
// A per-script id lets bootstrap.ts and a running wait-scan.ts coexist without logging each other out.
const SCRIPT = (process.argv[1] ?? "script").split("/").pop()!.replace(/\.ts$/, "");
const CLIENT_AUTH = `MediaBrowser Client="harakiri-dev", Device="${SCRIPT}", DeviceId="harakiri-dev-${SCRIPT}", Version="0"`;

// Jellyfin answers every route 503 ("Jellyfin Server is loading") while it starts, so a call that
// races the end of startup waits for it instead of failing a first-run bootstrap.
const UNAVAILABLE_RETRY_MS = 60_000;

export async function api<T = unknown>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {}
): Promise<T> {
  const auth = opts.token ? `${CLIENT_AUTH}, Token="${opts.token}"` : CLIENT_AUTH;

  const send = () =>
    fetch(BASE + path, {
      method,
      headers: {
        Authorization: auth,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

  const deadline = Date.now() + UNAVAILABLE_RETRY_MS;
  let res = await send();

  if (res.status === 503) {
    console.log(`${method} ${path} -> 503, server still starting; retrying`);
  }

  while (res.status === 503 && Date.now() < deadline) {
    await res.body?.cancel();
    await Bun.sleep(1000);
    res = await send();
  }

  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${await res.text().catch(() => "")}`);
  }

  const text = await res.text();

  return (text ? JSON.parse(text) : undefined) as T;
}

export async function waitForServer(
  timeoutMs = 180_000
): Promise<{ StartupWizardCompleted: boolean; Version: string }> {
  const deadline = Date.now() + timeoutMs;
  let last = "";

  while (Date.now() < deadline) {
    try {
      // While a fresh server starts, a transient host answers 200 in camelCase ("version"), then
      // drops connections and answers 503; only the real server answers with "Version".
      const info = await api<{ StartupWizardCompleted: boolean; Version: string } | undefined>(
        "GET",
        "/System/Info/Public"
      );

      if (typeof info?.Version === "string") {
        return info;
      }
      last = `not started yet: ${JSON.stringify(info)?.slice(0, 120)}`;
    } catch (e) {
      last = String(e);
    }

    await Bun.sleep(2000);
  }

  throw new Error(`server at ${BASE} not ready after ${timeoutMs}ms: ${last}`);
}

export async function login(): Promise<{ token: string; userId: string }> {
  const r = await api<{ AccessToken: string; User: { Id: string } }>(
    "POST",
    "/Users/AuthenticateByName",
    {
      body: { Username: USER, Pw: PASSWORD },
    }
  );

  return { token: r.AccessToken, userId: r.User.Id };
}
