import { describe, expect, test } from "vitest";

import { AccessToken, DeviceId, ItemId, MediaSourceId, ServerUrl } from "./ids";
import { authorizationHeader, mpvAuthorizationHeaderField, staticStreamUrl } from "./stream-url";

const identity = {
  client: "Harakiri",
  device: "Living Room TV",
  deviceId: DeviceId.parse("dev-42"),
  version: "0.1.0",
};
const token = AccessToken.parse("abc123");

describe("staticStreamUrl", () => {
  const itemId = ItemId.parse("0123456789abcdef0123456789abcdef");
  const mediaSourceId = MediaSourceId.parse("0123456789abcdef0123456789abcdef");

  test("builds the static passthrough URL", () => {
    expect(
      staticStreamUrl({ server: ServerUrl.parse("http://jf.lan:8096"), itemId, mediaSourceId })
    ).toBe(
      "http://jf.lan:8096/Videos/0123456789abcdef0123456789abcdef/stream?static=true&MediaSourceId=0123456789abcdef0123456789abcdef"
    );
  });

  test("keeps a reverse-proxy base path", () => {
    expect(
      staticStreamUrl({
        server: ServerUrl.parse("https://home.example/jellyfin"),
        itemId,
        mediaSourceId,
      })
    ).toBe(
      "https://home.example/jellyfin/Videos/0123456789abcdef0123456789abcdef/stream?static=true&MediaSourceId=0123456789abcdef0123456789abcdef"
    );
  });
});

describe("authorizationHeader", () => {
  test("formats the MediaBrowser scheme with the token", () => {
    expect(authorizationHeader(identity, token)).toBe(
      'MediaBrowser Client="Harakiri", Device="Living%20Room%20TV", DeviceId="dev-42", Version="0.1.0", Token="abc123"'
    );
  });

  test("omits the token before login", () => {
    expect(authorizationHeader(identity)).toBe(
      'MediaBrowser Client="Harakiri", Device="Living%20Room%20TV", DeviceId="dev-42", Version="0.1.0"'
    );
  });

  test("escapes quotes that would end a field", () => {
    expect(authorizationHeader({ ...identity, device: 'Bob\'s "TV"' })).toBe(
      'MediaBrowser Client="Harakiri", Device="Bob\'s%20%22TV%22", DeviceId="dev-42", Version="0.1.0"'
    );
  });

  test("produces one mpv http-header-fields entry", () => {
    expect(mpvAuthorizationHeaderField(identity, token)).toBe(
      'Authorization: MediaBrowser Client="Harakiri", Device="Living%20Room%20TV", DeviceId="dev-42", Version="0.1.0", Token="abc123"'
    );
  });
});

describe("id boundaries", () => {
  test("reject malformed input", () => {
    expect([
      ItemId.safeParse("not-a-guid").success,
      ServerUrl.safeParse("ftp://jf.lan").success,
      AccessToken.safeParse("").success,
    ]).toEqual([false, false, false]);
  });
});
