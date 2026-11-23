import { create } from "zustand";

import type { Entry } from "../data/entry";

/** A programme section that can own focus: tonight's screening or one row, named by a stable id. */
export interface Section {
  readonly id: string;
  readonly name: string;
}

/** The card that last held focus, by section id and entry id, so a row that moved still finds it. */
export interface Place {
  readonly section: string;
  readonly entry: string;
}

interface LitState {
  /** The entry the whole field is lit for: backdrop, title, notes and margin follow it together. */
  readonly entry: Entry | null;
  /** The section the entry was lit in. A section entered since has not lit its own card yet. */
  readonly litFor: string | null;
  readonly section: Section;
  readonly place: Place | null;
  /** When the section last changed, and whether it changed again within a repeat of that. */
  readonly movedAt: number;
  /** The section is moving under a held d-pad: the rows jump instead of gliding behind focus. */
  readonly travelling: boolean;
  /**
   * The featured film on stage, by id, so returning to the library resumes the same film even after
   * the shuffled featured list was refetched in another order.
   */
  readonly heroId: string | null;
  /** Moves the section at once, so held d-pad travel scrolls the rows without waiting for a relight. */
  readonly enter: (section: Section) => void;
  readonly light: (entry: Entry, section: Section) => void;
  readonly remember: (place: Place) => void;
  readonly setHeroId: (id: string | null) => void;
  readonly forget: () => void;
}

export const tonight: Section = { id: "tonight", name: "Tonight" };

/**
 * Two section changes closer than this are one held press: the gamepad repeats after 400 ms, then
 * every 120 ms.
 */
export const travelMs = 450;

export const useLit = create<LitState>()((set) => ({
  entry: null,
  litFor: null,
  section: tonight,
  place: null,
  heroId: null,
  movedAt: 0,
  travelling: false,
  enter: (section) => {
    set((state) => {
      if (state.section.id === section.id) {
        return state;
      }

      const now = Date.now();

      return { section, movedAt: now, travelling: now - state.movedAt < travelMs };
    });
  },
  light: (entry, section) => {
    set((state) =>
      state.section.id === section.id
        ? { entry, litFor: section.id, travelling: false }
        : { entry, litFor: section.id, section, movedAt: Date.now(), travelling: false }
    );
  },
  remember: (place) => {
    set({ place });
  },
  setHeroId: (heroId) => {
    set({ heroId });
  },
  forget: () => {
    set({
      entry: null,
      litFor: null,
      section: tonight,
      place: null,
      heroId: null,
      movedAt: 0,
      travelling: false,
    });
  },
}));

export const cardKey = (section: string, entry: string): string => `card|${section}|${entry}`;
export const rowKey = (section: string): string => `row|${section}`;

/**
 * Where focus lands when the library opens: the remembered card, then its row (norigin picks the
 * nearest card), then the hero, then the first row. Each is tried only if it is mounted.
 */
export const restoreKeys = (
  place: Place | null,
  hero: boolean,
  firstSection: string | undefined
): string[] => {
  const keys: string[] = [];

  if (place !== null) {
    keys.push(cardKey(place.section, place.entry), rowKey(place.section));
  }

  if (hero) {
    keys.push("hero-play");
  }

  if (firstSection !== undefined) {
    keys.push(rowKey(firstSection));
  }

  return keys;
};
