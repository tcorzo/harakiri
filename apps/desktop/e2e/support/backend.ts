import { resolve } from "node:path";

import { ServerUrl } from "@harakiri/jellyfin";

/**
 * The Jellyfin the e2e runs against. By default a real Jellyfin 12.4 container serving the
 * generated corpus, which globalSetup starts and bootstraps (`harakiri-jellyfin-e2e`, its own port
 * and state, left running for the next run; `mise run e2e:down` stops it). HARAKIRI_E2E_SERVER=<url>
 * runs the same suite against another server instead, signing in as HARAKIRI_E2E_USER /
 * HARAKIRI_E2E_PASSWORD (falling back to JELLYFIN_DEV_USER / _PASSWORD).
 */

export const REPO = resolve(import.meta.dirname, "../../../..");
export const CORPUS_DIR = process.env["HARAKIRI_CORPUS_DIR"] ?? resolve(REPO, ".cache/corpus");
export const REAL_SERVER = process.env["HARAKIRI_E2E_SERVER"];

const E2E_PORT = 8296;
/**
 * The app probes UDP 7359 at HARAKIRI_DISCOVERY_ADDRESS. A loopback address of the e2e server's
 * own keeps the probe from reaching a dev container on 127.0.0.1:7359, and 127.0.0.2 stays the
 * address where nothing answers.
 */
const E2E_DISCOVERY_ADDRESS = "127.0.0.3";

/** What jellyfin.sh and bootstrap.ts need to run the e2e container; `mise run e2e:down` repeats it. */
export const E2E_CONTAINER_ENV = {
  JELLYFIN_DEV_NAME: "harakiri-jellyfin-e2e",
  JELLYFIN_DEV_PORT: String(E2E_PORT),
  JELLYFIN_DEV_DISCOVERY_ADDRESS: E2E_DISCOVERY_ADDRESS,
  JELLYFIN_DEV_STATE: resolve(REPO, ".cache/jellyfin-e2e"),
  JELLYFIN_DEV_MEMORY: "2g",
  JELLYFIN_DEV_LIBRARY: "corpus",
  JELLYFIN_DEV_URL: `http://127.0.0.1:${E2E_PORT}`,
  JELLYFIN_DEV_USER: "harakiri",
  JELLYFIN_DEV_PASSWORD: "harakiri-dev",
  HARAKIRI_CORPUS_DIR: CORPUS_DIR,
} as const;

export interface Backend {
  /** `corpus`: the e2e container, whose items the tests look up by catalog entry. */
  readonly kind: "corpus" | "real";
  readonly server: ServerUrl;
  /** The address as an owner types it on the on-screen keyboard: host and port. */
  readonly address: string;
  readonly user: string;
  readonly password: string;
  /** Where HARAKIRI_DISCOVERY_ADDRESS points the app's UDP probe so this server answers it. */
  readonly discoveryAddress: string;
}

const env = (...names: string[]) =>
  names.map((name) => process.env[name]).find((value) => value !== undefined && value !== "");

export function resolveBackend(): Backend {
  if (REAL_SERVER !== undefined && REAL_SERVER !== "") {
    const server = ServerUrl.parse(REAL_SERVER);
    return {
      kind: "real",
      server,
      address: new URL(server).host,
      user: env("HARAKIRI_E2E_USER", "JELLYFIN_DEV_USER") ?? "harakiri",
      password: env("HARAKIRI_E2E_PASSWORD", "JELLYFIN_DEV_PASSWORD") ?? "harakiri-dev",
      // The dev container publishes its discovery port on loopback.
      discoveryAddress: env("HARAKIRI_E2E_DISCOVERY_ADDRESS") ?? "127.0.0.1",
    };
  }
  const server = ServerUrl.parse(E2E_CONTAINER_ENV.JELLYFIN_DEV_URL);
  return {
    kind: "corpus",
    server,
    address: new URL(server).host,
    user: E2E_CONTAINER_ENV.JELLYFIN_DEV_USER,
    password: E2E_CONTAINER_ENV.JELLYFIN_DEV_PASSWORD,
    discoveryAddress: E2E_DISCOVERY_ADDRESS,
  };
}
