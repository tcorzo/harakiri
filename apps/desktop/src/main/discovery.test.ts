// @vitest-environment node
import { createSocket, type Socket } from "node:dgram";
import { afterEach, expect, test } from "vitest";
import { discoverServers } from "./discovery";

let responder: Socket | undefined;

afterEach(() => {
  responder?.close();
  responder = undefined;
});

function startResponder(replies: string[]): Promise<{ port: number; probes: string[] }> {
  const probes: string[] = [];
  const socket = createSocket("udp4");
  responder = socket;
  socket.on("message", (message, from) => {
    probes.push(message.toString("utf8"));
    for (const reply of replies) socket.send(reply, from.port, from.address);
  });
  return new Promise((resolve) => {
    socket.bind(0, "127.0.0.1", () => resolve({ port: socket.address().port, probes }));
  });
}

test("collects valid replies, dedupes by Id and skips malformed ones", async () => {
  const living = JSON.stringify({
    Address: "http://192.168.1.10:8096",
    Id: "abc123",
    Name: "Living room",
    EndpointAddress: null,
  });
  const { port, probes } = await startResponder([
    living,
    living,
    "not json",
    JSON.stringify({ Address: "not a url", Id: "bad", Name: "Broken" }),
    JSON.stringify({ Address: "http://10.0.0.2:8096", Name: "No id" }),
    JSON.stringify({ Address: "ftp://10.0.0.3", Id: "ftp", Name: "Not http" }),
    JSON.stringify({ Address: "https://jf.example.com?x=1", Id: "def456", Name: "Remote" }),
  ]);

  const servers = await discoverServers({ address: "127.0.0.1", port, timeoutMs: 300 });

  expect(probes).toEqual(["Who is JellyfinServer?"]);
  expect(servers).toEqual([
    { id: "abc123", name: "Living room", address: "http://192.168.1.10:8096/" },
    { id: "def456", name: "Remote", address: "https://jf.example.com/" },
  ]);
});

test("returns an empty list when nobody answers", async () => {
  const { port } = await startResponder([]);

  await expect(discoverServers({ address: "127.0.0.1", port, timeoutMs: 100 })).resolves.toEqual(
    [],
  );
});
