import path from "node:path";

import { ServerUrl } from "@harakiri/jellyfin";

import { e2eServerFor } from "../../../../packages/harness/src/checkout";

/**
 * The Jellyfin the e2e runs against. By default a real Jellyfin 12.4 container serving the
 * generated corpus, which globalSetup starts and bootstraps, left running for the next run
 * (`mise run e2e:down` stops it). Every checkout has its own: its name, port and discovery address
 * derive from the checkout's path (packages/harness/src/checkout.ts), and its state is in this
 * checkout's .cache/jellyfin-e2e, so two checkouts can run e2e at once. HARAKIRI_E2E_SERVER=<url>
 * runs the same suite against another server instead, signing in as HARAKIRI_E2E_USER /
 * HARAKIRI_E2E_PASSWORD (falling back to JELLYFIN_DEV_USER / _PASSWORD).
 */

export const REPO = path.resolve(import.meta.dirname, "../../../..");
export const CORPUS_DIR = process.env.HARAKIRI_CORPUS_DIR ?? path.resolve(REPO, ".cache/corpus");
export const REAL_SERVER = process.env.HARAKIRI_E2E_SERVER;

/**
 * The app probes UDP 7359 at HARAKIRI_DISCOVERY_ADDRESS. The e2e server answers on a loopback
 * address of its own, so the probe reaches neither a dev container on 127.0.0.1:7359 nor another
 * checkout's e2e server, and 127.0.0.2 stays the address where nothing answers.
 */
export const E2E_SERVER = e2eServerFor(REPO);

/** What jellyfin.sh and bootstrap.ts need to run the e2e container; `mise run e2e:down` repeats it. */
export const E2E_CONTAINER_ENV = {
  JELLYFIN_DEV_NAME: E2E_SERVER.name,
  JELLYFIN_DEV_PORT: String(E2E_SERVER.port),
  JELLYFIN_DEV_DISCOVERY_ADDRESS: E2E_SERVER.discoveryAddress,
  JELLYFIN_DEV_STATE: path.resolve(REPO, ".cache/jellyfin-e2e"),
  JELLYFIN_DEV_MEMORY: "2g",
  JELLYFIN_DEV_LIBRARY: "corpus",
  JELLYFIN_DEV_URL: E2E_SERVER.url,
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

export const resolveBackend = (): Backend => {
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
    discoveryAddress: E2E_SERVER.discoveryAddress,
  };
};
