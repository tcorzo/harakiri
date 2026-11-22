import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LauncherStatus } from "../../../shared/bridge";
import { launcherStatusQuery, useLauncherStatusOnOpen } from "./queries";

const offered: LauncherStatus = { state: "offered", name: "Steam" };

const added: LauncherStatus = { state: "added", name: "Steam" };

const launcher = { status: vi.fn<() => Promise<LauncherStatus>>() };

/** A client whose cache already holds `offered`, as after the library's card read it. */
const cachedClient = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(launcherStatusQuery.queryKey, offered);

  return client;
};

const within = (client: QueryClient) => ({
  wrapper: ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  ),
});

describe("the launcher status", () => {
  beforeEach(() => {
    launcher.status.mockReset();
    launcher.status.mockResolvedValue(added);
    vi.stubGlobal("harakiri", { launcher });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("Settings reads it again each time it opens", async () => {
    const client = cachedClient();
    const settings = renderHook(useLauncherStatusOnOpen, within(client));

    await waitFor(() => {
      expect(settings.result.current.data).toStrictEqual(added);
    });
    expect(launcher.status).toHaveBeenCalledOnce();
  });

  it("the card keeps the cached value", async () => {
    const client = cachedClient();
    const card = renderHook(() => useQuery(launcherStatusQuery), within(client));

    await Promise.resolve();

    expect(card.result.current.data).toStrictEqual(offered);
    expect(launcher.status).not.toHaveBeenCalled();
  });
});
