import type { PlayerEvent } from "../../../shared/bridge";

/** The handoff's fixed stations, always in this order. */
export const stations = ["House", "Programme", "Picture"] as const;
export type Station = (typeof stations)[number];

/** The house takes a beat to dim; the slug holds long enough to read a full signal path from the couch. */
export const handoffTiming = { houseMs: 1200, slugMs: 3000 } as const;

export function stationOf(
  elapsed: "house" | "slug" | "picture",
  event: PlayerEvent | null,
): Station {
  if (elapsed === "picture" || event !== null) return "Picture";
  return elapsed === "house" ? "House" : "Programme";
}
