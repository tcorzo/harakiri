import { expect, test } from "vitest";
import { ServerUrl } from "./ids";

test.each([
  ["http://jf.lan:8096", "http://jf.lan:8096/"],
  ["http://jf.lan:8096/", "http://jf.lan:8096/"],
  ["https://home.example/jellyfin", "https://home.example/jellyfin/"],
  ["https://home.example/jellyfin/?api_key=x", "https://home.example/jellyfin/"],
  ["http://jf.lan:8096?x=1#/home", "http://jf.lan:8096/"],
  ["https://home.example/jellyfin#frag", "https://home.example/jellyfin/"],
  ["HTTP://JF.LAN:80/Path", "http://jf.lan/Path/"],
])("ServerUrl normalises %s to %s", (raw, expected) => {
  expect(ServerUrl.parse(raw)).toBe(expected);
});

test("ServerUrl is idempotent", () => {
  const once = ServerUrl.parse("https://home.example/jellyfin?x=1");
  expect(ServerUrl.parse(once)).toBe("https://home.example/jellyfin/");
});

test.each(["ftp://jf.lan/", "jf.lan:8096", "not a url"])("ServerUrl rejects %s", (raw) => {
  expect(ServerUrl.safeParse(raw).success).toBe(false);
});
