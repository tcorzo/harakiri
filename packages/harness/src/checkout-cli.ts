import path from "node:path";

import {
  LEGACY_E2E_NAME,
  checkoutIdOf,
  e2eServerFor,
  e2eStateOf,
  legacyE2eConfigSource,
  ownsLegacyE2e,
} from "./checkout";

/**
 * Prints one of this checkout's derived values for the shell:
 *   id                 the checkout id (dev/vm/guest.sh names the guest after it)
 *   e2e-name           the e2e Jellyfin container
 *   e2e-port           its HTTP port on 127.0.0.1
 *   e2e-discovery      the loopback address where it answers discovery
 *   e2e-legacy-name    the shared container that checkouts ran before each had its own
 *   e2e-legacy-owned   yes when that container exists and runs on this checkout's state, else no
 */
const repo = path.resolve(import.meta.dirname, "../../..");
const field = process.argv.at(2) ?? "";

const FIELDS = {
  // On the host, always the path's id: HARAKIRI_CHECKOUT_ID is read only in the guest.
  id: () => checkoutIdOf(repo),
  "e2e-name": () => e2eServerFor(repo).name,
  "e2e-port": () => String(e2eServerFor(repo).port),
  "e2e-discovery": () => e2eServerFor(repo).discoveryAddress,
  "e2e-legacy-name": () => LEGACY_E2E_NAME,
  "e2e-legacy-owned": () =>
    ownsLegacyE2e(legacyE2eConfigSource(), e2eStateOf(repo)) ? "yes" : "no",
} as const;

const isField = (name: string): name is keyof typeof FIELDS => Object.hasOwn(FIELDS, name);
const value = isField(field) ? FIELDS[field] : undefined;

if (value === undefined) {
  throw new Error(
    `usage: bun packages/harness/src/checkout-cli.ts ${Object.keys(FIELDS).join(" | ")} (got '${field}')`
  );
}

process.stdout.write(`${value()}\n`);
