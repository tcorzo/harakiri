import type { Direction } from "@harakiri/input";
import { getCurrentFocusKey, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LauncherAddResult, LauncherStatus } from "../../../shared/bridge";
import { dispatch, guardNavigation, useActionHandler, useNavigationGuard } from "../input/handlers";
import { startSpatial, stopSpatial } from "../test/spatial";
import { focusFirst } from "../ui/focus";
import { LauncherCard } from "./launcher-card";
import { useAddingToLauncher } from "./queries";

// The host's words; the card shows them as sent, so these differ from the desktop's.
const offered: LauncherStatus = {
  state: "offered",
  name: "Steam",
  launchHint: "Launch it from there next time.",
  retryHint: "Try again in a moment.",
};

const launcher = {
  status: vi.fn<() => Promise<LauncherStatus>>(),
  add: vi.fn<() => Promise<LauncherAddResult>>(),
};

const page = { back: 0 };

const HeroPlay = () => {
  const { ref } = useFocusable<object, HTMLButtonElement>({ focusKey: "hero-play" });

  return (
    <button ref={ref} type="button">
      Play
    </button>
  );
};

/** The library's own claims: Back returns to Play, and a guard that would take the d-pad there. */
const Page = ({ children }: { readonly children: ReactNode }) => {
  useActionHandler("back", () => {
    page.back += 1;
  });
  useNavigationGuard(() => focusFirst("hero-play"));

  return (
    <main>
      <HeroPlay />
      {children}
    </main>
  );
};

const mount = (client: QueryClient) =>
  render(
    <QueryClientProvider client={client}>
      <Page>
        <LauncherCard />
      </Page>
    </QueryClientProvider>
  );

const fresh = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const statusSettled = async (client: QueryClient): Promise<void> => {
  await waitFor(() => {
    expect(client.getQueryState(["launcher", "status"])?.status).toBe("success");
  });
};

/** The text of the line once it is on screen. */
const shown = async (text: string): Promise<string | null> => {
  const node = await screen.findByText(text);

  return node.textContent;
};

/**
 * One d-pad move through the guards, and where focus rests after it. norigin moves focus
 * asynchronously, so each move settles before the next.
 */
const move = async (direction: Direction): Promise<string> => {
  let handled = false;
  await act(async () => {
    handled = guardNavigation(direction);
    // oxlint-disable-next-line promise/avoid-new -- setTimeout has no promise form in the DOM lib
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });

  return `${direction} ${handled ? "held" : "free"} ${getCurrentFocusKey()}`;
};

const focusIs = async (key: string): Promise<void> => {
  await waitFor(() => {
    expect(getCurrentFocusKey()).toBe(key);
  });
};

/**
 * A cached status draws the card in the page's own first render, so the page's effects, and its
 * claims, land after the card's.
 */
const mountCached = async (): Promise<void> => {
  launcher.status.mockResolvedValue(offered);
  const client = fresh();
  client.setQueryData(["launcher", "status"], offered);
  mount(client);
  await focusIs("launcher-add");
};

describe("launcher card", () => {
  beforeEach(() => {
    page.back = 0;
    launcher.status.mockReset();
    launcher.add.mockReset();
    vi.stubGlobal("harakiri", { launcher });
    startSpatial();
  });

  afterEach(() => {
    cleanup();
    stopSpatial();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it.each(["unavailable", "added"] as const)(
    "shows nothing when the launcher is %s",
    async (state) => {
      launcher.status.mockResolvedValue(
        state === "unavailable" ? { state } : { state, name: "Steam" }
      );
      const client = fresh();
      mount(client);
      await statusSettled(client);
      expect(screen.queryByRole("region")).toBeNull();
    }
  );

  it("offers the launcher by the name main sends", async () => {
    launcher.status.mockResolvedValue(offered);
    mount(fresh());
    await expect(shown("Play harakiri from Steam")).resolves.toBe("Play harakiri from Steam");
    expect(screen.getByRole("region").textContent).toBe(
      "Play harakiri from Steam" +
        "Adds harakiri to your Steam library, with its art. Launch it from there next time." +
        "Add to SteamNot now"
    );
    await focusIs("launcher-add");
  });

  it("Not now hides it and it stays hidden on the next mount", async () => {
    launcher.status.mockResolvedValue(offered);
    const client = fresh();
    const first = mount(client);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Play harakiri from Steam")).toBeNull();
    await focusIs("hero-play");
    first.unmount();
    mount(client);
    await statusSettled(client);
    expect(screen.queryByText("Play harakiri from Steam")).toBeNull();
  });

  it("a timed-out add says what the host says to do next", async () => {
    const line = "Steam did not list harakiri in time. Try again in a moment.";
    launcher.status.mockResolvedValue(offered);
    launcher.add.mockResolvedValue({ state: "timedOut" });
    mount(fresh());
    fireEvent.click(await screen.findByRole("button", { name: "Add to Steam" }));
    await expect(shown(line)).resolves.toBe(line);
    // The card stays, so the owner can open the launcher and press Add again.
    expect(screen.getByRole("button", { name: "Add to Steam" }).textContent).toBe("Add to Steam");
  });

  it("a failed add shows the reason", async () => {
    const line = "Could not add harakiri to Steam: EACCES";
    launcher.status.mockResolvedValue(offered);
    launcher.add.mockResolvedValue({ state: "failed", reason: "EACCES" });
    mount(fresh());
    fireEvent.click(await screen.findByRole("button", { name: "Add to Steam" }));
    await expect(shown(line)).resolves.toBe(line);
  });

  it("says it is adding while it waits, and an added result hides it once the status refetches", async () => {
    const pending = Promise.withResolvers<LauncherAddResult>();
    launcher.status.mockResolvedValue(offered);
    launcher.add.mockReturnValue(pending.promise);
    mount(fresh());
    fireEvent.click(await screen.findByRole("button", { name: "Add to Steam" }));
    // A second press while it waits asks nothing more of the launcher.
    fireEvent.click(await screen.findByRole("button", { name: "Adding to Steam…" }));
    expect(launcher.add).toHaveBeenCalledOnce();

    launcher.status.mockResolvedValue({ state: "added", name: "Steam" });
    await act(async () => {
      pending.resolve({ state: "added" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByText("Play harakiri from Steam")).toBeNull();
    });
    expect(launcher.status).toHaveBeenCalledTimes(2);
    await focusIs("hero-play");
  });

  it("an add started on the card shows as under way to every other screen", async () => {
    const pending = Promise.withResolvers<LauncherAddResult>();
    launcher.status.mockResolvedValue(offered);
    launcher.add.mockReturnValue(pending.promise);
    const client = fresh();
    mount(client);
    fireEvent.click(await screen.findByRole("button", { name: "Add to Steam" }));

    // Settings reads this to say it is adding, and to hold off a second add.
    const elsewhere = renderHook(useAddingToLauncher, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });

    expect(elsewhere.result.current).toBe(true);

    await act(async () => {
      pending.resolve({ state: "timedOut" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(elsewhere.result.current).toBe(false);
    });
  });

  it("holds the d-pad on its two actions even when it mounts with the page that guards it", async () => {
    await mountCached();

    const trail = [
      await move("up"),
      await move("down"),
      await move("right"),
      await move("down"),
      await move("left"),
    ];

    expect(trail).toStrictEqual([
      "up held launcher-add",
      "down held launcher-add",
      "right held launcher-not-now",
      "down held launcher-not-now",
      "left held launcher-add",
    ]);
  });

  it("Back acts as Not now even when it mounts with the page that claims Back", async () => {
    await mountCached();
    act(() => {
      dispatch("back");
    });
    expect([page.back, screen.queryByText("Play harakiri from Steam")]).toStrictEqual([0, null]);
    await focusIs("hero-play");

    // Gone, the card gives Back to the page again.
    act(() => {
      dispatch("back");
    });
    expect(page.back).toBe(1);
  });
});
