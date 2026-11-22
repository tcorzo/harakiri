import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";

import { inGuest } from "./guest";

/**
 * What each checkout owns so that several can run e2e at once: its dev/vm guest and its e2e
 * Jellyfin. Both are named after the checkout id, the first 8 hex digits of the SHA-256 of the
 * checkout's real path. dev/vm/guest.sh, mise.toml and the e2e setup all read it from here
 * (checkout-cli.ts prints it for the shell).
 */

/** The shared e2e Jellyfin that checkouts ran before each got its own. `mise run e2e:down` removes it. */
export const LEGACY_E2E_NAME = "harakiri-jellyfin-e2e";

/**
 * The e2e Jellyfin's HTTP port is FIRST + (id mod SIZE): 20000-29999. That is clear of the dev
 * Jellyfin (8096), the legacy e2e port (8296) and Linux's ephemeral range (32768-60999).
 */
export const E2E_PORT_RANGE = { first: 20_000, size: 10_000 } as const;

const ID = /^[0-9a-f]{8}$/u;

/** The checkout id of the repo at `repo`: a symlinked path gives the same id as its target. */
export const checkoutIdOf = (repo: string): string =>
  createHash("sha256").update(realpathSync(repo)).digest("hex").slice(0, 8);

export interface E2eServer {
  /** The podman container. */
  readonly name: string;
  /** The HTTP port on the host's 127.0.0.1, which the guest also reaches over host loopback. */
  readonly port: number;
  readonly url: string;
  /**
   * The loopback address where the container answers UDP discovery (port 7359): 127.a.b.c with a
   * in 1-254 and c in 1-254. It is never in 127.0.0.0/24, so it stays clear of the dev server on
   * 127.0.0.1, the silent 127.0.0.2 the specs probe, and the legacy 127.0.0.3. Linux routes all of
   * 127.0.0.0/8 to lo, so nothing needs setting up.
   */
  readonly discoveryAddress: string;
}

const portOverride = (value: string): number => {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(`HARAKIRI_E2E_PORT must be a port from 1024 to 65535, not '${value}'`);
  }

  return port;
};

/** The e2e Jellyfin of the checkout with this id; `port` replaces the derived port. */
export const e2eServerOf = (id: string, port?: number): E2eServer => {
  if (!ID.test(id)) {
    throw new Error(`A checkout id is 8 lowercase hex digits, not '${id}'`);
  }

  const byte = (at: number) => Number.parseInt(id.slice(2 * at, 2 * at + 2), 16);
  const resolved = port ?? E2E_PORT_RANGE.first + (Number.parseInt(id, 16) % E2E_PORT_RANGE.size);
  const second = 1 + (byte(0) % 254);
  const third = byte(1);
  const fourth = 1 + (byte(2) % 254);

  return {
    name: `${LEGACY_E2E_NAME}-${id}`,
    port: resolved,
    url: `http://127.0.0.1:${resolved}`,
    discoveryAddress: `127.${second}.${third}.${fourth}`,
  };
};

/**
 * This checkout's e2e Jellyfin. In the dev/vm guest the repo is at /workspace, so its path says
 * nothing: guest.sh passes the host's id as HARAKIRI_CHECKOUT_ID. HARAKIRI_E2E_PORT replaces the
 * derived port when something else holds it.
 */
export const e2eServerFor = (
  repo: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  guest: boolean = inGuest()
): E2eServer => {
  const passed = env.HARAKIRI_CHECKOUT_ID;
  let id: string;

  if (passed !== undefined && passed !== "") {
    id = passed;
  } else if (guest) {
    throw new Error(
      "In the dev/vm guest the e2e Jellyfin is named after the host checkout, and HARAKIRI_CHECKOUT_ID is not set. Run the command through dev/vm/guest.sh exec, which sets it."
    );
  } else {
    id = checkoutIdOf(repo);
  }

  const port = env.HARAKIRI_E2E_PORT;

  return e2eServerOf(id, port === undefined || port === "" ? undefined : portOverride(port));
};
