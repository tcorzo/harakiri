import { createStore } from "zustand/vanilla";

/** When the owner last pressed anything; screens that move on their own wait for quiet. */
export const activity = createStore<{ readonly at: number }>()(() => ({ at: 0 }));

export function touch(): void {
  activity.setState({ at: Date.now() });
}
