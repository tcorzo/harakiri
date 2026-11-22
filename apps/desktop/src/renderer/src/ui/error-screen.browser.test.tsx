import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { noop } from "es-toolkit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ServerStatusError } from "../data/errors";
import { startSpatial, stopSpatial } from "../test/spatial";
import { ErrorScreen } from "./error-screen";

/** The error screen as the router shows it when a route's data fails with `error`. */
const showError = async (error: Error): Promise<void> => {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <ErrorScreen error={error} reset={noop} />,
    }),
    history: createMemoryHistory(),
  });

  await render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
};

/** Where an element sits on the 1920×1080 screen, in whole CSS pixels. */
const box = (name: string) => {
  const { left, top, right, bottom } = page
    .getByRole("button", { name })
    .element()
    .getBoundingClientRect();

  return {
    left: Math.round(left),
    top: Math.round(top),
    right: Math.round(right),
    bottom: Math.round(bottom),
  };
};

describe("error screen on a real layout", () => {
  beforeEach(startSpatial);
  afterEach(stopSpatial);

  it("signed out: the way on is focused, and the actions rest on the safe area's bottom edge", async () => {
    await showError(new ServerStatusError(401, "/Users/Me"));

    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Signed out by the server");
    await expect.element(page.getByRole("button", { name: "Sign in again" })).toHaveFocus();

    // 5vh of the 1080p screen is the safe area: 54px from the bottom, 96px from the left.
    const signIn = box("Sign in again");
    const change = box("Change server");
    expect([signIn.left, signIn.bottom]).toStrictEqual([96, 1026]);
    expect(change.bottom).toBe(1026);
    expect(change.left).toBeGreaterThan(signIn.right);
  });

  it("unreachable: what happened reads top to bottom above the way on, inside the safe area", async () => {
    await showError(new TypeError("Failed to fetch"));

    const heading = page.getByRole("heading", { level: 1 });
    const message = page.getByText("Failed to fetch");
    await expect.element(heading).toHaveTextContent("The server did not answer");
    await expect.element(message).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Try again" })).toHaveFocus();

    const title = heading.element().getBoundingClientRect();
    const said = message.element().getBoundingClientRect();
    const retry = box("Try again");
    expect(Math.round(title.left)).toBe(96);
    expect(title.right).toBeLessThanOrEqual(1920 - 96);
    expect(title.bottom).toBeLessThan(said.top);
    expect(said.bottom).toBeLessThan(retry.top);
    expect(retry.bottom).toBe(1026);
  });
});
