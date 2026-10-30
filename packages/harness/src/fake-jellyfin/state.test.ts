import { describe, expect, test } from "vitest";
import { startPlayState, updatePlayState, type UserData } from "./state";

const TICKS = 10_000_000;
const fresh = (): UserData => ({
  playbackPositionTicks: 0,
  playCount: 0,
  isFavorite: false,
  played: false,
  lastPlayedDate: undefined,
});

describe("the fake keeps resume points by Jellyfin's rules", () => {
  const film = 390 * TICKS;

  test("a position between 5% and 90% is kept as it is", () => {
    const data = fresh();
    updatePlayState(data, film, 200 * TICKS);
    expect(data).toMatchObject({ playbackPositionTicks: 200 * TICKS, played: false });
  });

  test("a position in the first 5% is dropped and the item stays unplayed", () => {
    const data = fresh();
    updatePlayState(data, film, 10 * TICKS);
    expect(data).toMatchObject({ playbackPositionTicks: 0, played: false });
  });

  test("past 90%, or in the last second, the item is played and the position cleared", () => {
    for (const at of [360 * TICKS, film - TICKS / 2]) {
      const data = fresh();
      updatePlayState(data, film, at);
      expect(data).toMatchObject({ playbackPositionTicks: 0, played: true });
    }
  });

  test("an item under 5 minutes never keeps a resume point", () => {
    const data = fresh();
    updatePlayState(data, 180 * TICKS, 90 * TICKS);
    expect(data).toMatchObject({ playbackPositionTicks: 0, played: true });
  });

  test("a start counts a play, dates it, and unmarks a played item", () => {
    const data = { ...fresh(), played: true, playCount: 2 };
    startPlayState(data);
    expect(data.playCount).toBe(3);
    expect(data.played).toBe(false);
    expect(data.lastPlayedDate).toEqual(expect.any(String));
  });
});
