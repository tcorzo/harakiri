import path from "node:path";

import { checkoutIdOf, e2eServerFor } from "./checkout";

/**
 * Prints one of this checkout's derived values for the shell:
 *   id              the checkout id (dev/vm/guest.sh names the guest after it)
 *   e2e-name        the e2e Jellyfin container
 *   e2e-port        its HTTP port on 127.0.0.1
 *   e2e-discovery   the loopback address where it answers discovery
 */
const repo = path.resolve(import.meta.dirname, "../../..");
const field = process.argv.at(2) ?? "";

const FIELDS = {
  // Always the path's: guest.sh must not name the guest after an inherited variable.
  id: () => checkoutIdOf(repo),
  "e2e-name": () => e2eServerFor(repo).name,
  "e2e-port": () => String(e2eServerFor(repo).port),
  "e2e-discovery": () => e2eServerFor(repo).discoveryAddress,
} as const;

const isField = (name: string): name is keyof typeof FIELDS => Object.hasOwn(FIELDS, name);
const value = isField(field) ? FIELDS[field] : undefined;

if (value === undefined) {
  throw new Error(
    `usage: bun packages/harness/src/checkout-cli.ts ${Object.keys(FIELDS).join(" | ")} (got '${field}')`
  );
}

process.stdout.write(`${value()}\n`);
