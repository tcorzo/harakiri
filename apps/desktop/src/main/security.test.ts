// @vitest-environment node
import type { HeadersReceivedResponse } from "electron";
import { describe, expect, it } from "vitest";

import {
  appUrlCheck,
  confineWebContents,
  contentSecurityPolicy,
  ForeignSenderError,
  fromAppOnly,
  installContentSecurityPolicy,
} from "./security";

const packaged = appUrlCheck("file:///opt/harakiri/resources/app/out/renderer/index.html");
const dev = appUrlCheck("http://localhost:5173/");

type HeadersSession = Parameters<typeof installContentSecurityPolicy>[0];

type HeadersListener = Parameters<HeadersSession["webRequest"]["onHeadersReceived"]>[0];

type ResourceType = Parameters<HeadersListener>[0]["resourceType"];

type NavigationListener = (event: { url: string; preventDefault: () => void }) => void;

const headersFor = (
  url: string,
  resourceType: ResourceType
): HeadersReceivedResponse | undefined => {
  let listener: HeadersListener | undefined;

  const session: HeadersSession = {
    webRequest: {
      onHeadersReceived: (l) => {
        listener = l;
      },
    },
  };

  installContentSecurityPolicy(session, packaged, "default-src 'none'");
  let response: HeadersReceivedResponse | undefined;
  listener?.({ url, resourceType, responseHeaders: { "Content-Type": ["text/html"] } }, (r) => {
    response = r;
  });

  return response;
};

const fakeContents = () => {
  const listeners = new Map<string, NavigationListener>();
  let openHandler: (() => { action: "deny" }) | undefined;

  confineWebContents(
    {
      on: (name: "will-navigate" | "will-attach-webview", listener: NavigationListener) => {
        listeners.set(name, listener);
      },
      setWindowOpenHandler: (handler) => {
        openHandler = handler;
      },
    },
    packaged
  );

  const emit = (name: string, url = ""): "prevented" | "allowed" => {
    let prevented = false;
    listeners.get(name)?.({
      url,
      preventDefault: () => {
        prevented = true;
      },
    });

    return prevented ? "prevented" : "allowed";
  };

  return { emit, openWindow: () => openHandler?.() };
};

const eventFrom = (url: string | null) => ({ senderFrame: url === null ? null : { url } });

describe(appUrlCheck, () => {
  it.each([
    ["file:///opt/harakiri/resources/app/out/renderer/index.html", true],
    ["file:///opt/harakiri/resources/app/out/renderer/index.html#/onboarding", true],
    ["file:///etc/passwd", false],
    ["file:///opt/harakiri/resources/app/out/renderer/other.html", false],
    ["https://evil.example/", false],
    ["http://localhost:5173/", false],
    ["not a url", false],
  ])("packaged app url check: %s -> %s", (url, expected) => {
    expect(packaged(url)).toBe(expected);
  });

  it.each([
    ["http://localhost:5173/", true],
    ["http://localhost:5173/#/home", true],
    ["http://localhost:5174/", false],
    ["http://jf.lan:8096/web/", false],
    ["file:///opt/harakiri/resources/app/out/renderer/index.html", false],
  ])("dev app url check: %s -> %s", (url, expected) => {
    expect(dev(url)).toBe(expected);
  });
});

describe(contentSecurityPolicy, () => {
  it("the packaged policy keeps scripts same-origin and lets Jellyfin images and fetches through", () => {
    expect(contentSecurityPolicy("file:///app/index.html")).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' http: https: data: blob:; font-src 'self' data:; " +
        "connect-src 'self' http: https:; object-src 'none'; base-uri 'none'; " +
        "form-action 'none'; frame-ancestors 'none'"
    );
  });

  it("the dev policy adds what the Vite dev server needs", () => {
    const policy = contentSecurityPolicy("http://localhost:5173/");
    expect(policy).toContain("script-src 'self' 'unsafe-inline';");
    expect(policy).toContain("connect-src 'self' http: https: ws:;");
  });
});

describe(installContentSecurityPolicy, () => {
  it("the CSP header is added to the app document only", () => {
    expect(
      headersFor("file:///opt/harakiri/resources/app/out/renderer/index.html", "mainFrame")
    ).toStrictEqual({
      responseHeaders: {
        "Content-Type": ["text/html"],
        "Content-Security-Policy": ["default-src 'none'"],
      },
    });
    expect(headersFor("http://jf.lan:8096/Items", "xhr")).toStrictEqual({});
  });
});

describe(confineWebContents, () => {
  it("navigation to a foreign URL is denied and navigation within the app is allowed", () => {
    const { emit } = fakeContents();

    expect(emit("will-navigate", "https://evil.example/")).toBe("prevented");
    expect(emit("will-navigate", "file:///etc/passwd")).toBe("prevented");
    expect(
      emit("will-navigate", "file:///opt/harakiri/resources/app/out/renderer/index.html#/home")
    ).toBe("allowed");
  });

  it("new windows and webviews are denied", () => {
    const { emit, openWindow } = fakeContents();

    expect(openWindow()).toStrictEqual({ action: "deny" });
    expect(emit("will-attach-webview")).toBe("prevented");
  });
});

describe(fromAppOnly, () => {
  it("IPC from a foreign frame is rejected and IPC from the app is answered", () => {
    const handler = fromAppOnly(packaged, (_event, n: number) => n * 2);

    expect(() => handler(eventFrom("https://evil.example/frame"), 21)).toThrow(
      new ForeignSenderError("https://evil.example/frame")
    );
    expect(() => handler(eventFrom(null), 21)).toThrow("Rejected IPC from a destroyed frame");
    expect(
      handler(eventFrom("file:///opt/harakiri/resources/app/out/renderer/index.html#/home"), 21)
    ).toBe(42);
  });
});
