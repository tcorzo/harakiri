import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { encodeShortcuts } from "../steam/fixtures/vdf";
import type { ShortcutEntry } from "../steam/fixtures/vdf";

/**
 * Builds `<home>/.local/share/Steam/userdata/<id>/config/` for each user, with a `shortcuts.vdf`
 * when entries are given (`null` leaves the file out). Returns the Steam root.
 */
export const fakeSteamRoot = (
  home: string,
  users: Readonly<Record<string, readonly ShortcutEntry[] | null>>
): string => {
  const root = path.join(home, ".local", "share", "Steam");

  for (const [id, entries] of Object.entries(users)) {
    const config = path.join(root, "userdata", id, "config");
    mkdirSync(config, { recursive: true });

    if (entries !== null) {
      writeFileSync(path.join(config, "shortcuts.vdf"), encodeShortcuts(entries));
    }
  }

  return root;
};
