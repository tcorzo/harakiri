import type { HeadersReceivedResponse, OnHeadersReceivedListenerDetails } from "electron";

/** True when `url` is the app itself: the packaged index.html (any hash route) or the dev server. */
export type AppUrlCheck = (url: string) => boolean;

export const appUrlCheck = (appUrl: string): AppUrlCheck => {
  const app = new URL(appUrl);

  return (url) => {
    let candidate: URL;

    try {
      candidate = new URL(url);
    } catch {
      return false;
    }

    if (app.protocol === "file:") {
      return candidate.protocol === "file:" && candidate.pathname === app.pathname;
    }

    return candidate.origin === app.origin;
  };
};

/**
 * The renderer talks to the Jellyfin server directly, whose origin is only known after sign-in,
 * so images and fetches allow any http(s) origin while scripts stay same-origin.
 */
export const contentSecurityPolicy = (appUrl: string): string => {
  const dev = new URL(appUrl).protocol !== "file:";

  return [
    "default-src 'none'",
    // The Vite dev server injects an inline React Refresh preamble and talks HMR over a WebSocket.
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' http: https: data: blob:",
    "font-src 'self' data:",
    dev ? "connect-src 'self' http: https: ws:" : "connect-src 'self' http: https:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
};

type HeadersDetails = Pick<
  OnHeadersReceivedListenerDetails,
  "url" | "resourceType" | "responseHeaders"
>;

/** The slice of Electron's session that `installContentSecurityPolicy` reads. */
interface HeadersSession {
  webRequest: {
    onHeadersReceived: (
      listener: (
        details: HeadersDetails,
        respond: (response: HeadersReceivedResponse) => void
      ) => void
    ) => void;
  };
}

export const installContentSecurityPolicy = (
  session: HeadersSession,
  isAppUrl: AppUrlCheck,
  policy: string
): void => {
  session.webRequest.onHeadersReceived((details, respond) => {
    if (details.resourceType !== "mainFrame" || !isAppUrl(details.url)) {
      respond({});

      return;
    }

    respond({
      responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [policy] },
    });
  });
};

interface GuardedEvent {
  preventDefault: () => void;
}

interface NavigationEvent extends GuardedEvent {
  readonly url: string;
}

/** The slice of Electron's WebContents that `confineWebContents` reads. */
interface GuardedContents {
  on: ((event: "will-navigate", listener: (event: NavigationEvent) => void) => void) &
    ((event: "will-attach-webview", listener: (event: GuardedEvent) => void) => void);
  setWindowOpenHandler: (handler: () => { action: "deny" }) => void;
}

/** Keeps a web view on the app: no navigation away, no new windows, no embedded webviews. */
export const confineWebContents = (contents: GuardedContents, isAppUrl: AppUrlCheck): void => {
  contents.on("will-navigate", (event) => {
    if (!isAppUrl(event.url)) {
      event.preventDefault();
    }
  });
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
};

export class ForeignSenderError extends Error {
  constructor(url: string | undefined) {
    super(`Rejected IPC from ${url ?? "a destroyed frame"}`);
    this.name = "ForeignSenderError";
  }
}

interface SenderEvent {
  readonly senderFrame: { readonly url: string } | null;
}

/** Wraps an IPC handler so only frames showing the app can call it. */
export const fromAppOnly =
  <Event extends SenderEvent, Args extends unknown[], Result>(
    isAppUrl: AppUrlCheck,
    handler: (event: Event, ...args: Args) => Result
  ): ((event: Event, ...args: Args) => Result) =>
  (event, ...args) => {
    const url = event.senderFrame?.url;

    if (url === undefined || !isAppUrl(url)) {
      throw new ForeignSenderError(url);
    }

    return handler(event, ...args);
  };
