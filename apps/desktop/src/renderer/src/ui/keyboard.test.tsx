import {
  FocusContext,
  getCurrentFocusKey,
  navigateByDirection,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { place, remeasure, startSpatial, stopSpatial } from "../test/spatial";
import { ListAction } from "./actions";
import { focusFirst } from "./focus";
import { EntryField, Keyboard } from "./keyboard";

const seen = { typed: "", submitted: 0 };

/** The server step's shape: servers found on the left, the field above the board on the right. */
function ServerStep() {
  const [value, setValue] = useState("ab");
  useEffect(() => {
    seen.typed = value;
  }, [value]);

  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: "page",
    trackChildren: true,
  });

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref}>
        <ListAction focusKey="found-0" label="harakiri-dev" onPress={() => {}} />
        <EntryField
          focusKey="field"
          label="Server address"
          value={value}
          masked={false}
          onChange={setValue}
          onSubmit={() => (seen.submitted += 1)}
        />
        <Keyboard
          focusKey="kb"
          layout="address"
          value={value}
          onChange={setValue}
          onSubmit={() => {}}
          submitLabel="Connect"
        />
      </div>
    </FocusContext.Provider>
  );
}

function layOut(): void {
  place(screen.getByRole("button", { name: "harakiri-dev" }), {
    x: 0,
    y: 250,
    width: 300,
    height: 70,
  });
  place(screen.getByRole("textbox"), { x: 400, y: 100, width: 1000, height: 80 });
  const board = screen.getByRole("group", { name: "On-screen keyboard" });
  place(board, { x: 400, y: 250, width: 1000, height: 400 });

  // Four rows of ten keys, then the wide row of five.
  for (const [i, key] of [...board.querySelectorAll("button")].entries()) {
    place(
      key,
      i < 40
        ? { x: 400 + (i % 10) * 100, y: 250 + Math.floor(i / 10) * 80, width: 90, height: 70 }
        : { x: 400 + (i - 40) * 200, y: 570, width: 190, height: 70 }
    );
  }
}

async function press(direction: "up" | "down" | "left" | "right"): Promise<string> {
  await act(async () => {
    await navigateByDirection(direction);
  });

  return getCurrentFocusKey();
}

async function focus(key: string): Promise<void> {
  await act(async () => {
    focusFirst(key);
  });
}

beforeEach(async () => {
  startSpatial();
  render(<ServerStep />);
  layOut();
  await remeasure();
});

afterEach(() => {
  cleanup();
  stopSpatial();
  vi.restoreAllMocks();
});

test("up from the top row of keys reaches the address field", async () => {
  await focus("kb-0-3");
  await expect(press("up")).resolves.toBe("field");
});

test("left from the first key column reaches the servers found", async () => {
  await focus("kb-1-0");
  await expect(press("left")).resolves.toBe("found-0");
});

test("the board holds focus at its right and bottom edges, where nothing lies", async () => {
  await focus("kb-1-9");
  await expect(press("right")).resolves.toBe("kb-1-9");
  await focus("kb-4-4");
  await expect(press("down")).resolves.toBe("kb-4-4");
});

test("inside the board the d-pad moves key by key", async () => {
  await focus("kb-1-0");
  await expect(press("right")).resolves.toBe("kb-1-1");
  await expect(press("down")).resolves.toBe("kb-2-1");
});

test("a physical Backspace on a focused key deletes, and never reaches the hub as Back", async () => {
  const hub = vi.fn<(event: KeyboardEvent) => void>();
  window.addEventListener("keydown", hub);
  await focus("kb-1-0");

  fireEvent.keyDown(screen.getByRole("button", { name: "q" }), { key: "Backspace" });
  expect(seen.typed).toBe("a");
  fireEvent.keyDown(screen.getByRole("button", { name: "q" }), { key: "x" });
  expect(seen.typed).toBe("ax");
  expect(hub).not.toHaveBeenCalled();
  window.removeEventListener("keydown", hub);
});

test("Space on a focused key types no space and reaches the hub, where it is Select", async () => {
  const hub = vi.fn<(event: KeyboardEvent) => void>();
  window.addEventListener("keydown", hub);
  await focus("kb-1-0");

  fireEvent.keyDown(screen.getByRole("button", { name: "q" }), { key: " " });
  expect(seen.typed).toBe("ab");
  expect(hub).toHaveBeenCalledOnce();
  expect(hub.mock.calls[0]?.[0].defaultPrevented).toBe(false);
  window.removeEventListener("keydown", hub);
});

test("Enter in the field submits once and never reaches the hub as Select", async () => {
  const hub = vi.fn<(event: KeyboardEvent) => void>();
  window.addEventListener("keydown", hub);
  seen.submitted = 0;

  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(seen.submitted).toBe(1);
  expect(hub).not.toHaveBeenCalled();
  window.removeEventListener("keydown", hub);
});
