import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { DeviceId, ServerUrl } from "./ids";
import {
  authenticate,
  authenticateWithQuickConnect,
  initiateQuickConnect,
  pollQuickConnect,
  quickConnectEnabled,
} from "./session";

const server = ServerUrl.parse("http://jf.test/");
const identity = {
  client: "Harakiri",
  device: "TV",
  deviceId: DeviceId.parse("dev-1"),
  version: "0.1.0",
};
const ANONYMOUS = 'MediaBrowser Client="Harakiri", Device="TV", DeviceId="dev-1", Version="0.1.0"';
const USER = "5f2a9c1e0b7d4e3fa8c6d1b2e9f04a7c";

const received: { method: string; url: string; auth: string | null; body: unknown }[] = [];
const record = async (request: Request) => {
  const url = new URL(request.url);
  received.push({
    method: request.method,
    url: `${url.pathname}${url.search}`,
    auth: request.headers.get("Authorization"),
    body: request.method === "POST" ? await request.json().catch(() => null) : null,
  });
};
const signedIn = { AccessToken: "tok-1", ServerId: "srv-1", User: { Id: USER, Name: "harakiri" } };

const mock = setupServer(
  http.get("http://jf.test/System/Info/Public", () =>
    HttpResponse.json({ Id: "srv-1", ServerName: "harakiri-dev", Version: "12.4.0" }),
  ),
  http.post("http://jf.test/Users/AuthenticateByName", async ({ request }) => {
    await record(request);
    const { Pw } = z.object({ Pw: z.string() }).parse(received.at(-1)?.body);
    if (Pw === "right") return HttpResponse.json(signedIn);
    if (Pw === "rejected") return new HttpResponse(null, { status: 403 });
    return new HttpResponse("Error processing request.", { status: 401 });
  }),
  http.get("http://jf.test/QuickConnect/Enabled", () => HttpResponse.json(true)),
  http.post("http://jf.test/QuickConnect/Initiate", async ({ request }) => {
    await record(request);
    return HttpResponse.json({ Code: "123456", Secret: "s3cret", Authenticated: false });
  }),
  http.get("http://jf.test/QuickConnect/Connect", async ({ request }) => {
    await record(request);
    return HttpResponse.json({ Code: "123456", Secret: "s3cret", Authenticated: true });
  }),
  http.post("http://jf.test/Users/AuthenticateWithQuickConnect", async ({ request }) => {
    await record(request);
    return HttpResponse.json(signedIn);
  }),
);

beforeAll(() => mock.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  received.length = 0;
  mock.resetHandlers();
});
afterAll(() => mock.close());

const session = {
  serverUrl: "http://jf.test/",
  serverId: "srv-1",
  serverName: "harakiri-dev",
  serverVersion: "12.4.0",
  userId: USER,
  userName: "harakiri",
  accessToken: "tok-1",
  deviceId: "dev-1",
};

test("authenticate sends the client identity and returns everything a Session needs", async () => {
  expect(await authenticate(server, "harakiri", "right", identity)).toEqual({
    kind: "signed-in",
    session,
  });
  expect(received).toEqual([
    {
      method: "POST",
      url: "/Users/AuthenticateByName",
      auth: ANONYMOUS,
      body: { Username: "harakiri", Pw: "right" },
    },
  ]);
});

test("a wrong password and a refusing server are told apart", async () => {
  expect(await authenticate(server, "harakiri", "wrong", identity)).toEqual({
    kind: "wrong-credentials",
  });
  expect(await authenticate(server, "harakiri", "rejected", identity)).toEqual({
    kind: "rejected",
    status: 403,
  });
});

test("an unreachable server says so", async () => {
  mock.use(http.get("http://jf.test/System/Info/Public", () => HttpResponse.error()));
  const result = await authenticate(server, "harakiri", "right", identity);
  expect(result.kind).toBe("unreachable");
});

test("Quick Connect: enabled, initiate, poll, then sign in with the secret", async () => {
  expect(await quickConnectEnabled(server, identity)).toBe(true);
  expect(await initiateQuickConnect(server, identity)).toEqual({
    code: "123456",
    secret: "s3cret",
  });
  expect(await pollQuickConnect(server, identity, "s3cret")).toBe(true);
  expect(await authenticateWithQuickConnect(server, identity, "s3cret")).toEqual({
    kind: "signed-in",
    session,
  });
  expect(received).toEqual([
    { method: "POST", url: "/QuickConnect/Initiate", auth: ANONYMOUS, body: null },
    { method: "GET", url: "/QuickConnect/Connect?secret=s3cret", auth: ANONYMOUS, body: null },
    {
      method: "POST",
      url: "/Users/AuthenticateWithQuickConnect",
      auth: ANONYMOUS,
      body: { Secret: "s3cret" },
    },
  ]);
});
