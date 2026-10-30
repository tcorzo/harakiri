import type { Entry } from "../data/entry";

/** An episode carries its series' catalogue number. */
export function numberFor(numbers: ReadonlyMap<string, number>, entry: Entry): number | null {
  return numbers.get(entry.series?.id ?? entry.id) ?? numbers.get(entry.id) ?? null;
}
