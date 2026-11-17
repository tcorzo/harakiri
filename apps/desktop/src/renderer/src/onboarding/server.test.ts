import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkServer } from "./server";

const jellyfin = {
  Id: "3f14640a0c8c41eeaf7b64f3109eb203",
  ServerName: "living-room-jellyfin",
  Version: "10.11.7",
  ProductName: "Jellyfin Server",
};

interface Answer {
  readonly Id?: string;
  readonly ServerName?: string;
  readonly Version?: string;
  readonly ProductName?: string;
  readonly hello?: string;
}

/** Answers each origin with its JSON body; an origin left out refuses, as Chromium's fetch does. */
const network = (answers: Record<string, Answer>): void => {
  // oxlint-disable-next-line eslint/require-await -- a fetch stub must return a promise and has nothing to await
  vi.stubGlobal("fetch", async (input: Request | string | URL) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const body = answers[url.origin];

    if (body === undefined) {
      throw new TypeError("Failed to fetch");
    }

    return Response.json(body);
  });
};

const fresh = () => new QueryClient();

describe("server", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the candidate that answers as Jellyfin wins over one that refuses the connection", async () => {
    network({ "http://films.example:8096": jellyfin });
    await expect(
      checkServer(fresh(), ["https://films.example/", "http://films.example:8096/"])
    ).resolves.toStrictEqual({
      ok: true,
      info: {
        url: "http://films.example:8096/",
        id: jellyfin.Id,
        name: "living-room-jellyfin",
        version: "10.11.7",
      },
    });
  });

  it("when no candidate is Jellyfin, the one that answered names the problem", async () => {
    network({ "http://films.example:8096": { hello: "world" } });
    await expect(
      checkServer(fresh(), ["https://films.example/", "http://films.example:8096/"])
    ).resolves.toStrictEqual({ ok: false, problem: { kind: "notJellyfin" } });
    await expect(checkServer(fresh(), ["https://films.example/"])).resolves.toStrictEqual({
      ok: false,
      problem: { kind: "unreachable" },
    });
  });
});
