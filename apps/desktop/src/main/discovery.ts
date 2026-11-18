import { createSocket } from "node:dgram";

import { ServerUrl } from "@harakiri/jellyfin";
import { getLogger } from "@logtape/logtape";
import { z } from "zod";

import type { DiscoveredServer } from "../shared/bridge";

const logger = getLogger(["harakiri", "discovery"]);

const DiscoveryReply = z
  .object({ Address: ServerUrl, Id: z.string().min(1), Name: z.string() })
  .transform((reply): DiscoveredServer => ({
    id: reply.Id,
    name: reply.Name,
    address: reply.Address,
  }));

export interface DiscoveryOptions {
  address?: string;
  port?: number;
  timeoutMs?: number;
}

/** Broadcasts Jellyfin's discovery probe and returns every distinct server that answers in time. */
export async function discoverServers(options: DiscoveryOptions = {}): Promise<DiscoveredServer[]> {
  const { address = "255.255.255.255", port = 7359, timeoutMs = 1500 } = options;
  const servers = new Map<string, DiscoveredServer>();
  const socket = createSocket("udp4");

  return await new Promise((resolve) => {
    let done = false;

    const finish = (): void => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      socket.close();
      resolve([...servers.values()]);
    };

    const timer = setTimeout(finish, timeoutMs);

    socket.on("message", (message) => {
      let json: unknown;

      try {
        json = JSON.parse(message.toString("utf-8"));
      } catch {
        logger.debug("Ignoring a discovery reply that is not JSON");

        return;
      }

      const parsed = DiscoveryReply.safeParse(json);

      if (!parsed.success) {
        logger.debug("Ignoring a malformed discovery reply: {issues}", {
          issues: parsed.error.issues,
        });

        return;
      }

      if (!servers.has(parsed.data.id)) {
        servers.set(parsed.data.id, parsed.data);
      }
    });
    socket.on("error", (error) => {
      logger.warn("Server discovery failed: {error}", { error });
      finish();
    });
    socket.bind(0, () => {
      socket.setBroadcast(true);
      socket.send("Who is JellyfinServer?", port, address);
    });
  });
}
