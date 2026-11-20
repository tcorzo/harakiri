import type { InputMode } from "@harakiri/input";
import { createStore } from "zustand/vanilla";

interface InputModeState {
  readonly mode: InputMode;
  readonly setMode: (mode: InputMode) => void;
}

/** Read by the input hub on every event, outside React. */
export const inputMode = createStore<InputModeState>()((set) => ({
  mode: "ui",
  setMode: (mode) => {
    set({ mode });
  },
}));
