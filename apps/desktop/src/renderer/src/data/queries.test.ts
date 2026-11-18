import { ItemId } from "@harakiri/jellyfin";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";

import { type PlayerEvent, Session } from "../../../shared/bridge";
import { toEntry } from "./entry";
import { refetchWhenReported } from "./queries";
import { signedIn } from "./session";

const ctx = signedIn(
  Session.parse({
    serverUrl: "http://jf.test",
    serverId: "s",
    serverName: "Test",
    serverVersion: "10.11.0",
    userId: "fedcba9876543210fedcba9876543210",
    userName: "tester",
    accessToken: "token",
    deviceId: "device-1",
  })
);

const entry = toEntry({ Id: "0123456789abcdef0123456789abcdef", Name: "Film", Type: "Movie" });

const listeners = new Set<(event: PlayerEvent) => void>();

const emit = (phase: PlayerEvent["phase"], itemId = entry.id) => {
  for (const listener of listeners)
    listener({
      phase,
      itemId,
      positionTicks: 0,
      facts: [],
      downgrades: [],
      transcodeReasons: [],
      unreadable: false,
    });
};

Object.defineProperty(window, "harakiri", {
  configurable: true,
  value: {
    player: {
      onEvent: (listener: (event: PlayerEvent) => void) => {
        listeners.add(listener);

        return () => listeners.delete(listener);
      },
    },
  },
});

afterEach(() => listeners.clear());

test("the played item is refetched only once the server has the stop report, and only once", () => {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
  refetchWhenReported(queryClient, ctx, entry);

  emit("stopped");
  emit("reported", ItemId.parse("ffffffffffffffffffffffffffffffff"));
  expect(invalidate).not.toHaveBeenCalled();

  emit("reported");
  expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey?.at(-1))).toContain("resume");
  expect(listeners.size).toBe(0);
});
