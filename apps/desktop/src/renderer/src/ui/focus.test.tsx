import { getCurrentFocusKey, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";

import { restoreKeys } from "../library/lit";
import { startSpatial, stopSpatial } from "../test/spatial";
import { focusFirst } from "./focus";

function Focusable({ focusKey }: { readonly focusKey: string }) {
  const { ref } = useFocusable<object, HTMLButtonElement>({ focusKey });

  return (
    <button ref={ref} type="button">
      {focusKey}
    </button>
  );
}

beforeEach(startSpatial);

afterEach(() => {
  cleanup();
  stopSpatial();
});

test("a remembered card that is gone falls back to its row, found by id, not by position", async () => {
  // Continue Watching lost the card the owner left, and a new row now sits above it.
  render(
    <>
      <Focusable focusKey="row|resume" />
      <Focusable focusKey="row|next-up" />
      <Focusable focusKey="hero-play" />
    </>
  );
  let moved = false;
  await act(async () => {
    moved = focusFirst(...restoreKeys({ section: "next-up", entry: "gone" }, true, "resume"));
  });
  expect([moved, getCurrentFocusKey()]).toEqual([true, "row|next-up"]);
});

test("nothing mounted means focus is left alone rather than handed a dead key", async () => {
  render(<Focusable focusKey="title-subtitles" />);
  await act(async () => {
    focusFirst("title-subtitles");
  });
  expect(focusFirst("title-play", "season-0")).toBe(false);
  expect(getCurrentFocusKey()).toBe("title-subtitles");
});
