import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { noop } from "es-toolkit";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import type { LauncherStatus } from "../../../shared/bridge";
import { useInputHub } from "../input/hub";
import { LauncherCard } from "../launcher/launcher-card";
import { installBridge, unstubbedBridge } from "../test/bridge";
import { startSpatial, stopSpatial } from "../test/spatial";
import { PlayAction, QuietAction } from "../ui/actions";
import { focusFirst } from "../ui/focus";
import { useBackToLeave } from "./exit-sheet";

/**
 * The library's Back, at its seam: Play on the stage above one card of a row. As on the library,
 * focusing Play holds the stage, and focusing a card leaves it for the rows.
 */
const Library = ({ launcher = false }: { readonly launcher?: boolean }) => {
  useInputHub();
  const [holding, setHolding] = useState(true);
  const exitSheet = useBackToLeave(holding, true);

  const { ref, focusKey } = useFocusable<object, HTMLElement>({
    focusKey: "library",
    trackChildren: true,
  });

  useEffect(() => {
    focusFirst("hero-play");
  }, []);

  return (
    <FocusContext.Provider value={focusKey}>
      <main
        ref={ref}
        aria-label="Library"
        className="px-safe-x py-safe-y relative flex h-screen w-screen flex-col gap-24"
      >
        <div>
          <PlayAction
            focusKey="hero-play"
            label="Play Tonight"
            onFocus={() => {
              setHolding(true);
            }}
            onPress={noop}
          >
            Play
          </PlayAction>
        </div>
        <div>
          <QuietAction
            focusKey="row-film"
            label="A film in the rows"
            onFocus={() => {
              setHolding(false);
            }}
            onPress={noop}
          >
            A film
          </QuietAction>
        </div>
        {launcher ? <LauncherCard /> : null}
        {exitSheet}
      </main>
    </FocusContext.Provider>
  );
};

const button = (name: string) => page.getByRole("button", { name });
const sheet = () => page.getByRole("region", { name: "Leave harakiri?" });

const press = async (key: string): Promise<void> => {
  await userEvent.keyboard(`{${key}}`);
};

describe("leaving from the library", () => {
  const quit = vi.fn<() => Promise<void>>(async () => {
    await Promise.resolve();
  });

  beforeEach(async () => {
    quit.mockClear();
    installBridge({
      ...unstubbedBridge,
      app: { quit },
      updates: {
        ...unstubbedBridge.updates,
        status: async () => await Promise.resolve({ state: "ready", version: "0.3.0" }),
      },
    });
    startSpatial();
    await render(
      <QueryClientProvider client={new QueryClient()}>
        <Library />
      </QueryClientProvider>
    );
  });

  afterEach(() => {
    stopSpatial();
    installBridge();
  });

  it("Back from a row returns to Play; Back from Play asks to leave, with Stay focused", async () => {
    await expect.element(button("Play Tonight")).toHaveFocus();
    await press("ArrowDown");
    await expect.element(button("A film in the rows")).toHaveFocus();

    await press("Escape");
    await expect.element(button("Play Tonight")).toHaveFocus();
    await expect.element(sheet()).not.toBeInTheDocument();

    await press("Escape");
    await expect.element(sheet()).toBeVisible();
    await expect.element(button("Stay")).toHaveFocus();
    await expect
      .element(button("Quit harakiri").getByText("Installs 0.3.0 as it closes"))
      .toBeVisible();
    await page.screenshot();

    await press("Escape");
    await expect.element(sheet()).not.toBeInTheDocument();
    await expect.element(button("Play Tonight")).toHaveFocus();
    expect(quit).not.toHaveBeenCalled();
  });

  it("Stay closes the sheet and returns to Play", async () => {
    await expect.element(button("Play Tonight")).toHaveFocus();
    await press("Escape");
    await expect.element(button("Stay")).toHaveFocus();

    await press("Enter");
    await expect.element(sheet()).not.toBeInTheDocument();
    await expect.element(button("Play Tonight")).toHaveFocus();
    expect(quit).not.toHaveBeenCalled();
  });

  it("Quit harakiri quits once", async () => {
    await expect.element(button("Play Tonight")).toHaveFocus();
    await press("Escape");
    await expect.element(button("Stay")).toHaveFocus();

    await press("ArrowDown");
    await expect.element(button("Quit harakiri")).toHaveFocus();
    await press("Enter");

    await vi.waitFor(() => {
      expect(quit).toHaveBeenCalledOnce();
    });
  });

  it("once Stay is pressed, Quit harakiri cannot answer while the sheet leaves", async () => {
    await expect.element(button("Play Tonight")).toHaveFocus();
    await press("Escape");
    await expect.element(button("Stay")).toHaveFocus();

    await press("Enter");
    await press("ArrowDown");
    await press("Enter");

    await expect.element(sheet()).not.toBeInTheDocument();
    await expect.element(button("Play Tonight")).toHaveFocus();
    expect(quit).not.toHaveBeenCalled();
  });
});

describe("a card that arrives under the open exit sheet", () => {
  let launcher = Promise.withResolvers<LauncherStatus>();

  beforeEach(async () => {
    launcher = Promise.withResolvers<LauncherStatus>();
    installBridge({
      ...unstubbedBridge,
      launcher: {
        ...unstubbedBridge.launcher,
        status: async () => await launcher.promise,
      },
      updates: {
        ...unstubbedBridge.updates,
        status: async () => await Promise.resolve({ state: "unsupported" }),
      },
    });
    startSpatial();
    await render(
      <QueryClientProvider client={new QueryClient()}>
        <Library launcher />
      </QueryClientProvider>
    );
  });

  afterEach(() => {
    stopSpatial();
    installBridge();
  });

  it("leaves focus, the d-pad and Back with the sheet", async () => {
    await expect.element(button("Play Tonight")).toHaveFocus();
    await press("Escape");
    await expect.element(button("Stay")).toHaveFocus();

    launcher.resolve({ state: "offered", name: "Steam", launchHint: "hint", retryHint: "retry" });
    await expect
      .element(page.getByRole("region", { name: "Play harakiri from Steam" }))
      .toBeVisible();
    await expect.element(button("Stay")).toHaveFocus();

    await press("ArrowDown");
    await expect.element(button("Quit harakiri")).toHaveFocus();

    await press("Escape");
    await expect.element(sheet()).not.toBeInTheDocument();
    await expect.element(button("Play Tonight")).toHaveFocus();
  });
});
