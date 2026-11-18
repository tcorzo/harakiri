import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";

import { checkServer } from "./server";

const jellyfin = {
  Id: "3f14640a0c8c41eeaf7b64f3109eb203",
  ServerName: "living-room-jellyfin",
  Version: "10.11.7",
  ProductName: "Jellyfin Server",
};

/** Answers each origin with its JSON body; an origin left out refuses, as Chromium's fetch does. */
function network(answers: Record<string, object>): void {
  vi.stubGlobal("fetch", async (input: Request | string | URL) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const body = answers[url.origin];

    if (body === undefined) throw new TypeError("Failed to fetch");

    return Response.json(body);
  });
}

const fresh = () => new QueryClient();

afterEach(() => {
  vi.unstubAllGlobals();
});

test("the candidate that answers as Jellyfin wins over one that refuses the connection", async () => {
  network({ "http://films.example:8096": jellyfin });
  expect(
    await checkServer(fresh(), ["https://films.example/", "http://films.example:8096/"])
  ).toEqual({
    ok: true,
    info: {
      url: "http://films.example:8096/",
      id: jellyfin.Id,
      name: "living-room-jellyfin",
      version: "10.11.7",
    },
  });
});

test("when no candidate is Jellyfin, the one that answered names the problem", async () => {
  network({ "http://films.example:8096": { hello: "world" } });
  expect(
    await checkServer(fresh(), ["https://films.example/", "http://films.example:8096/"])
  ).toEqual({ ok: false, problem: { kind: "notJellyfin" } });
  expect(await checkServer(fresh(), ["https://films.example/"])).toEqual({
    ok: false,
    problem: { kind: "unreachable" },
  });
});
