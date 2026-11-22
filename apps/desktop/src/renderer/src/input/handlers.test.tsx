import type { Direction } from "@harakiri/input";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { dispatch, guardNavigation, useActionHandler, useNavigationGuard } from "./handlers";
import type { ClaimLayer } from "./handlers";

/** Each claim mounts as its own tree, so they register in the order they are listed. */
const mountBackClaims = (claims: readonly (readonly [string, ClaimLayer])[], ran: string[]) =>
  claims.map(([name, layer]) =>
    renderHook(() => {
      useActionHandler(
        "back",
        () => {
          ran.push(name);
        },
        layer
      );
    })
  );

const mountGuards = (claims: readonly (readonly [string, ClaimLayer])[], ran: string[]) =>
  claims.map(([name, layer]) =>
    renderHook(() => {
      useNavigationGuard((direction: Direction) => {
        ran.push(`${name}:${direction}`);

        return true;
      }, layer);
    })
  );

const OVERLAY_FIRST = [
  ["overlay", "overlay"],
  ["page one", "page"],
  ["page two", "page"],
] as const;

describe("action claims", () => {
  afterEach(() => {
    cleanup();
  });

  it("an overlay registered before two pages answers", () => {
    const ran: string[] = [];
    mountBackClaims(OVERLAY_FIRST, ran);

    expect(dispatch("back")).toBe(true);
    expect(ran).toStrictEqual(["overlay"]);
  });

  it("once the overlay unmounts, the last page answers", () => {
    const ran: string[] = [];
    const [overlay] = mountBackClaims(OVERLAY_FIRST, ran);

    overlay?.unmount();

    expect(dispatch("back")).toBe(true);
    expect(ran).toStrictEqual(["page two"]);
  });

  it("with no claim, the hub falls back", () => {
    expect(dispatch("back")).toBe(false);
  });
});

describe("navigation guards", () => {
  afterEach(() => {
    cleanup();
  });

  it("an overlay registered before two pages answers", () => {
    const ran: string[] = [];
    mountGuards(OVERLAY_FIRST, ran);

    expect(guardNavigation("down")).toBe(true);
    expect(ran).toStrictEqual(["overlay:down"]);
  });

  it("once the overlay unmounts, the last page answers", () => {
    const ran: string[] = [];
    const [overlay] = mountGuards(OVERLAY_FIRST, ran);

    overlay?.unmount();

    expect(guardNavigation("left")).toBe(true);
    expect(ran).toStrictEqual(["page two:left"]);
  });

  it("with no guard, the spatial search runs", () => {
    expect(guardNavigation("up")).toBe(false);
  });
});
