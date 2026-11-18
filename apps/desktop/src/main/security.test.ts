// @vitest-environment node
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { expect, test } from "vitest";

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

test.each([
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

test.each([
  ["http://localhost:5173/", true],
  ["http://localhost:5173/#/home", true],
  ["http://localhost:5174/", false],
  ["http://jf.lan:8096/web/", false],
  ["file:///opt/harakiri/resources/app/out/renderer/index.html", false],
])("dev app url check: %s -> %s", (url, expected) => {
  expect(dev(url)).toBe(expected);
});

test("the packaged policy keeps scripts same-origin and lets Jellyfin images and fetches through", () => {
  expect(contentSecurityPolicy("file:///app/index.html")).toBe(
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' http: https: data: blob:; font-src 'self' data:; " +
      "connect-src 'self' http: https:; object-src 'none'; base-uri 'none'; " +
      "form-action 'none'; frame-ancestors 'none'"
  );
});

test("the dev policy adds what the Vite dev server needs", () => {
  const policy = contentSecurityPolicy("http://localhost:5173/");
  expect(policy).toContain("script-src 'self' 'unsafe-inline';");
  expect(policy).toContain("connect-src 'self' http: https: ws:;");
});

type HeadersListener = Parameters<
  Electron.Session["webRequest"]["onHeadersReceived"]
>[0] extends infer L
  ? Extract<L, (...args: never[]) => unknown>
  : never;

function headersFor(url: string, resourceType: string): unknown {
  let listener: HeadersListener | undefined;

  const session = {
    webRequest: {
      onHeadersReceived: (l: HeadersListener) => {
        listener = l;
      },
    },
  } as unknown as Pick<Electron.Session, "webRequest">;

  installContentSecurityPolicy(session, packaged, "default-src 'none'");
  let response: unknown;
  listener?.(
    {
      url,
      resourceType,
      responseHeaders: { "Content-Type": ["text/html"] },
    } as unknown as Electron.OnHeadersReceivedListenerDetails,
    (r) => {
      response = r;
    }
  );

  return response;
}

test("the CSP header is added to the app document only", () => {
  expect(
    headersFor("file:///opt/harakiri/resources/app/out/renderer/index.html", "mainFrame")
  ).toEqual({
    responseHeaders: {
      "Content-Type": ["text/html"],
      "Content-Security-Policy": ["default-src 'none'"],
    },
  });
  expect(headersFor("http://jf.lan:8096/Items", "xhr")).toEqual({});
});

function fakeContents() {
  const listeners = new Map<string, (event: { url?: string; preventDefault(): void }) => void>();
  let openHandler: (() => unknown) | undefined;

  const contents = {
    on: (name: string, listener: (event: { url?: string; preventDefault(): void }) => void) => {
      listeners.set(name, listener);

      return contents;
    },
    setWindowOpenHandler: (handler: () => unknown) => {
      openHandler = handler;
    },
  };

  confineWebContents(contents as unknown as WebContents, packaged);

  const emit = (name: string, url?: string): "prevented" | "allowed" => {
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
}

test("navigation to a foreign URL is denied and navigation within the app is allowed", () => {
  const { emit } = fakeContents();

  expect(emit("will-navigate", "https://evil.example/")).toBe("prevented");
  expect(emit("will-navigate", "file:///etc/passwd")).toBe("prevented");
  expect(
    emit("will-navigate", "file:///opt/harakiri/resources/app/out/renderer/index.html#/home")
  ).toBe("allowed");
});

test("new windows and webviews are denied", () => {
  const { emit, openWindow } = fakeContents();

  expect(openWindow()).toEqual({ action: "deny" });
  expect(emit("will-attach-webview")).toBe("prevented");
});

const eventFrom = (url: string | null) =>
  ({ senderFrame: url === null ? null : { url } }) as unknown as IpcMainInvokeEvent;

test("IPC from a foreign frame is rejected and IPC from the app is answered", () => {
  const handler = fromAppOnly(packaged, (_event, n: number) => n * 2);

  expect(() => handler(eventFrom("https://evil.example/frame"), 21)).toThrow(
    new ForeignSenderError("https://evil.example/frame")
  );
  expect(() => handler(eventFrom(null), 21)).toThrow("Rejected IPC from a destroyed frame");
  expect(
    handler(eventFrom("file:///opt/harakiri/resources/app/out/renderer/index.html#/home"), 21)
  ).toBe(42);
});
