import type { ServerUrl } from "@harakiri/jellyfin";
import { delay, noop } from "es-toolkit";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Entry } from "../data/entry";
import { useLit } from "./lit";
import { titleLogoUrl } from "./stage";

/** What the block over the stage shows: an entry, staged as the hero or listed for a lit card. */
export interface Face {
  readonly entry: Entry;
  readonly staged: boolean;
}

/**
 * When the block swaps after it starts to leave. Its fade out (the stylesheet's, 100 ms) ends well
 * before, so the swap always lands while nobody sees it.
 */
export const faceOutMs = 160;

/** The longest the block waits for its new title logo before it returns anyway. */
export const faceReadyCapMs = 600;

const faceKey = (face: Face | null): string | null =>
  face === null ? null : `${face.staged ? "staged" : "listed"}|${face.entry.id}`;

interface Presented {
  readonly face: Face | null;
  readonly visible: boolean;
}

const nothingToPrepare = async (): Promise<void> => {
  // Nothing to load: the block returns as soon as it has swapped.
};

/**
 * The block only changes while nobody sees it. A new entry, or the hero leaving or taking the stage,
 * first takes the block out, then swaps it, and brings it back once `prepare` (its title logo
 * decoding) settles; a null target keeps it out. Fresher data for the same face shows at once.
 */
export const usePresentedFace = (
  target: Face | null,
  prepare: (face: Face) => Promise<void> = nothingToPrepare
): Presented => {
  const key = faceKey(target);

  const [state, setState] = useState<Presented>(() => ({
    face: target,
    visible: target !== null,
  }));

  const latest = useRef(target);
  const current = useRef(state);
  const prepared = useRef(prepare);
  // Each swap takes a number; a reveal that lost to a later swap does nothing.
  const swaps = useRef(0);

  useEffect(() => {
    latest.current = target;
    current.current = state;
    prepared.current = prepare;
  });

  const swap = useCallback(() => {
    swaps.current += 1;
    const mine = swaps.current;
    const next = latest.current;
    setState({ face: next, visible: false });

    if (next === null) {
      return;
    }

    const reveal = async (): Promise<void> => {
      await Promise.race([prepared.current(next).catch(noop), delay(faceReadyCapMs)]);

      if (swaps.current === mine && faceKey(latest.current) === faceKey(next)) {
        setState({ face: latest.current, visible: true });
      }
    };

    void reveal();
  }, []);

  useEffect(() => {
    const now = current.current;

    if (key === faceKey(now.face)) {
      // Back to the face that was leaving: it returns without a swap.
      if (!now.visible && now.face !== null) {
        swaps.current += 1;
        setState({ face: now.face, visible: true });
      }

      return noop;
    }

    setState({ face: now.face, visible: false });

    const timer = window.setTimeout(swap, now.visible ? faceOutMs : 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [key, swap]);

  // Fresher data for the face on show (the full title landing) is kept, so the block leaves with it.
  // Adjusted during render, as React does for state derived from props.
  if (target !== null && key === faceKey(state.face) && state.face?.entry !== target.entry) {
    setState({ face: target, visible: state.visible });
  }

  const face = key !== null && key === faceKey(state.face) ? target : state.face;

  return { face, visible: state.visible };
};

const decodeLogo = async (server: ServerUrl, face: Face): Promise<void> => {
  if (face.entry.logo === null) {
    return;
  }

  const image = new Image();
  image.src = titleLogoUrl(server, face.entry.logo, face.staged);
  await image.decode();
};

/** Waits up to `faceReadyCapMs` for an entry to be complete, then lets it show as it is. */
const useComplete = (id: string | null, complete: boolean): boolean => {
  const [gaveUp, setGaveUp] = useState<string | null>(null);

  useEffect(() => {
    if (complete || id === null) {
      return noop;
    }

    const timer = window.setTimeout(() => {
      setGaveUp(id);
    }, faceReadyCapMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [complete, id]);

  return complete || (id !== null && gaveUp === id);
};

/**
 * The block over the library stage: the hero while it holds the stage, and a card only once that card
 * is lit in the row focus moved to, so the hero's title never lands in the rows' layout on its way out.
 * It also waits for the entry's full title (`complete`): a row's item has no logo or streams yet, and
 * the block should arrive once, not refill in front of the owner.
 */
export const useStageFace = (
  server: ServerUrl,
  holding: boolean,
  shown: Entry | null,
  complete: boolean
) => {
  const sectionId = useLit((s) => s.section.id);
  const litEntry = useLit((s) => s.entry);
  const litFor = useLit((s) => s.litFor);
  const settled = holding || (litEntry !== null && litFor === sectionId);
  const ready = useComplete(shown?.id ?? null, complete);

  const prepare = useCallback(
    async (face: Face) => {
      await decodeLogo(server, face);
    },
    [server]
  );

  const presented = usePresentedFace(
    settled && ready && shown !== null ? { entry: shown, staged: holding } : null,
    prepare
  );

  return { ...presented, staged: presented.face?.staged ?? holding };
};
