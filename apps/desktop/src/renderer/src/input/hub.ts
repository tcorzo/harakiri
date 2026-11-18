import {
  idlePad,
  isDirection,
  isEditing,
  keyToAction,
  seedHeld,
  route,
  stepPad,
  type Action,
  type PadSnapshot,
  type PadState,
} from "@harakiri/input";
import {
  doesFocusableExist,
  getCurrentFocusKey,
  navigateByDirection,
  SpatialNavigation,
} from "@noriginmedia/norigin-spatial-navigation";
import { useEffect } from "react";
import { match } from "ts-pattern";

import { touch } from "./activity";
import { dispatch, guardNavigation } from "./handlers";
import { inputMode } from "./mode";

const noPad: PadSnapshot = { buttons: [], axes: [] };

/** Presses what norigin has focused, which is what the owner sees marked, whatever the DOM thinks. */
async function pressFocused(): Promise<void> {
  const key = getCurrentFocusKey();

  if (!doesFocusableExist(key)) {
    return;
  }
  const { node } = await SpatialNavigation.getNodeLayoutByFocusKey(key);
  node.click();
}

function perform(action: Action): void {
  touch();
  match(action)
    .with("up", "down", "left", "right", (direction) => {
      if (!guardNavigation(direction)) {
        void navigateByDirection(direction);
      }
    })
    .with("select", () => void pressFocused())
    .with("back", () => {
      if (!dispatch("back")) {
        window.history.back();
      }
    })
    .with("menu", "playPause", (other) => void dispatch(other))
    .exhaustive();
}

function firstPad(): PadSnapshot {
  return navigator.getGamepads().find((pad) => pad?.connected === true) ?? noPad;
}

/** The single path from keyboard and gamepad to app actions, gated by the input mode. */
export function useInputHub(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Keys a focused text field types with are left to the field, unprevented.
      const editing = isEditing(document.activeElement);
      const action = keyToAction(event.key, { editing });

      if (action === undefined) {
        return;
      }

      // Held directions repeat; a held Select or Back acts once, and its repeats must not reach the
      // button's native Enter either (the same rule as keyToAction's `repeat`).
      if (event.repeat && !isDirection(action)) {
        event.preventDefault();

        return;
      }

      const routed = route(inputMode.getState().mode, "keyboard", action);

      if (routed === undefined) {
        return;
      }
      event.preventDefault();
      perform(routed);
    };

    let pad: PadState = idlePad;
    let lastMode = inputMode.getState().mode;
    let frame = 0;

    const poll = (now: number): void => {
      const snapshot = firstPad();
      const mode = inputMode.getState().mode;

      // Buttons already down when the mode flips (the B that stopped mpv) must not act on this side too.
      if (mode !== lastMode) {
        pad = seedHeld(snapshot, now);
        lastMode = mode;
      }

      const step = stepPad(pad, snapshot, now);
      pad = step.state;

      for (const action of step.actions) {
        const routed = route(mode, "gamepad", action);

        if (routed !== undefined) {
          perform(routed);
        }
      }

      frame = requestAnimationFrame(poll);
    };

    window.addEventListener("keydown", onKeyDown);
    frame = requestAnimationFrame(poll);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      cancelAnimationFrame(frame);
    };
  }, []);
}
