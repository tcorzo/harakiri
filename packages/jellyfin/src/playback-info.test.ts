import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ServerVersion, playbackInfoRequest } from "./device-profile";
import { createClient } from "./generated/client";
import { getPostedPlaybackInfo } from "./generated/sdk.gen";
import { AccessToken, DeviceId, ItemId, UserId } from "./ids";
import { authorizationHeader } from "./stream-url";

const received: { auth: string | null; body: unknown }[] = [];

const server = setupServer(
  http.post("http://jf.test/Items/:itemId/PlaybackInfo", async ({ request }) => {
    received.push({ auth: request.headers.get("Authorization"), body: await request.json() });

    return HttpResponse.json({ MediaSources: [], PlaySessionId: "ps-1" });
  })
);

describe(playbackInfoRequest, () => {
  beforeAll(() => {
    server.listen({ onUnhandledFrame: "error" });
  });

  afterAll(() => {
    server.close();
  });

  it("the server receives a condition-free profile and the auth header through the generated ky client", async () => {
    const identity = {
      client: "Harakiri",
      device: "TV",
      deviceId: DeviceId.parse("dev-1"),
      version: "0.1.0",
    };

    const client = createClient({
      baseUrl: "http://jf.test",
      auth: () => authorizationHeader(identity, AccessToken.parse("tok")),
    });

    const userId = UserId.parse("5f2a9c1e0b7d4e3fa8c6d1b2e9f04a7c");

    const { data } = await getPostedPlaybackInfo({
      client,
      throwOnError: true,
      path: { itemId: ItemId.parse("0123456789abcdef0123456789abcdef") },
      body: playbackInfoRequest({
        userId,
        server: ServerVersion.parse("12.4.0"),
        source: { kind: "default" },
      }),
    });

    expect(data.PlaySessionId).toBe("ps-1");
    expect(received).toHaveLength(1);
    const [request] = received;
    expect(request?.auth).toBe(
      'MediaBrowser Client="Harakiri", Device="TV", DeviceId="dev-1", Version="0.1.0", Token="tok"'
    );
    expect(request?.body).toMatchObject({
      MaxStreamingBitrate: 1_000_000_000,
      SubtitleStreamIndex: -1,
      EnableDirectPlay: true,
      DeviceProfile: {
        MaxStreamingBitrate: 1_000_000_000,
        CodecProfiles: [],
        DirectPlayProfiles: [{ Type: "Video" }, { Type: "Audio" }, { Type: "Photo" }],
      },
    });
  });
});
