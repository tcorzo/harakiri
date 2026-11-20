import { once } from "node:events";
import { createServer } from "node:http";

import type { JsonValue } from "./mpv";

export interface StubReply {
  readonly status: number;
  readonly body: string;
  readonly type?: string;
}

export interface Stub {
  /** The address as an owner would type it: host and port, no scheme. */
  readonly address: string;
  /** Every request path the stub saw, in order, so a test can prove the app asked it. */
  readonly seen: string[];
  readonly close: () => Promise<void>;
}

const json = (status: number, value: JsonValue): StubReply => ({
  status,
  body: JSON.stringify(value),
  type: "application/json",
});

export const reply = { json };

/**
 * A tiny HTTP server on 127.0.0.1 standing in for a server the dev Jellyfin cannot impersonate.
 * Routes match the path case-insensitively, without the query; anything else is a 404 page.
 * It answers CORS like Jellyfin does, since the renderer calls it from the app's own origin.
 */
export const stubServer = async (routes: Readonly<Record<string, StubReply>>): Promise<Stub> => {
  const table = new Map(Object.entries(routes).map(([path, r]) => [path.toLowerCase(), r]));
  const seen: string[] = [];

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://stub").pathname;
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    if (request.method === "OPTIONS") {
      response.writeHead(204).end();

      return;
    }

    seen.push(`${request.method ?? "GET"} ${path}`);

    const found = table.get(path.toLowerCase()) ?? {
      status: 404,
      body: "<!doctype html><title>Not Found</title><h1>Not Found</h1>",
      type: "text/html",
    };

    response.writeHead(found.status, { "Content-Type": found.type ?? "text/plain" });
    response.end(found.body);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const bound = server.address();

  if (!(bound instanceof Object)) {
    throw new TypeError("The stub is not on a TCP port");
  }

  const { port } = bound;

  return {
    address: `127.0.0.1:${port}`,
    seen,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
};

/** A loopback port with nothing listening on it: the kernel refuses the connection at once. */
export const deadAddress = async (): Promise<string> => {
  const stub = await stubServer({});
  await stub.close();

  return stub.address;
};
