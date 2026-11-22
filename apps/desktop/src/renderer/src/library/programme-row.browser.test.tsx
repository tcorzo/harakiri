import { defaultRepeat } from "@harakiri/input";
import { ServerUrl } from "@harakiri/jellyfin";
import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { delay, noop } from "es-toolkit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import { toEntry } from "../data/entry";
import type { Entry } from "../data/entry";
import { useInputHub } from "../input/hub";
import { startSpatial, stopSpatial } from "../test/spatial";
import { focusFirst } from "../ui/focus";
import { PosterCard, StillCard } from "./cards";
import { cardKey } from "./lit";
import { ProgrammeRow } from "./programme-row";

const server = ServerUrl.parse("http://jellyfin.invalid");
const numbers: ReadonlyMap<string, number> = new Map();

const films = (prefix: string, count: number): readonly Entry[] =>
  Array.from({ length: count }, (_, at) =>
    toEntry({
      Id: `${prefix}${String(at + 1).padStart(32 - prefix.length, "0")}`,
      Name: `${prefix === "a" ? "Resume" : "Film"} ${at + 1}`,
      Type: "Movie",
    })
  );

const resume = films("a", 4);
const programme = films("b", 16);

/** Two rows of the library, the way LibraryScreen stacks them, driven through the input hub. */
const Programme = () => {
  useInputHub();

  const { ref, focusKey } = useFocusable<object, HTMLElement>({
    focusKey: "library",
    trackChildren: true,
  });

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} aria-label="Library" className="flex flex-col gap-10">
        <ProgrammeRow
          sectionId="resume"
          sectionName="Continue Watching"
          entries={resume}
          Card={StillCard}
          pitchRem={26}
          heightRem={19.5}
          server={server}
          numbers={numbers}
          onFocusEntry={noop}
          onPressEntry={noop}
        />
        <ProgrammeRow
          sectionId="films"
          sectionName="Films"
          entries={programme}
          Card={PosterCard}
          pitchRem={15.5}
          heightRem={26}
          server={server}
          numbers={numbers}
          onFocusEntry={noop}
          onPressEntry={noop}
        />
      </main>
    </FocusContext.Provider>
  );
};

const card = (name: string) => page.getByRole("button", { name });

/**
 * Presses a key, waits for focus to land where it should, then waits out a held pad's repeat, as
 * the owner's input never comes faster: the next press acts on a row that has had a frame to scroll.
 */
const press = async (key: string, lands: string): Promise<void> => {
  await userEvent.keyboard(`{${key}}`);
  await expect.element(card(lands)).toHaveFocus();
  await delay(defaultRepeat.intervalMs);
};

describe("programme rows on a real layout", () => {
  beforeEach(startSpatial);
  afterEach(stopSpatial);

  it("Right walks a row past the cards on screen, mounting the next ones as the row scrolls", async () => {
    await render(<Programme />);
    focusFirst(cardKey("films", programme[0]?.id ?? ""));
    await expect.element(card("Film 1")).toHaveFocus();

    // A 1080p screen shows eight posters; the virtualizer mounts four more past the edge.
    expect(page.getByRole("region", { name: "Films" }).getByRole("button").elements()).toHaveLength(
      12
    );

    /* oxlint-disable eslint/no-await-in-loop -- ordered key presses, each acting where the last landed */
    for (let at = 2; at <= 16; at += 1) {
      await press("ArrowRight", `Film ${at}`);
    }
    /* oxlint-enable eslint/no-await-in-loop */

    // The row's last card has nothing to its right, so focus stays on it.
    await press("ArrowRight", "Film 16");
  });

  it("Down drops from a card to the row below, and Up returns to the card it left", async () => {
    await render(<Programme />);
    focusFirst(cardKey("resume", resume[0]?.id ?? ""));
    await expect.element(card("Resume 1")).toHaveFocus();

    await press("ArrowRight", "Resume 2");
    await press("ArrowRight", "Resume 3");
    await press("ArrowDown", "Film 1");
    await press("ArrowRight", "Film 2");
    await press("ArrowUp", "Resume 3");
  });
});
