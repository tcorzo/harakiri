import path from "node:path";

import { ServerUrl } from "@harakiri/jellyfin";

import { e2eServerFor, e2eStateOf } from "../../../../packages/harness/src/checkout";
import type { E2eServer } from "../../../../packages/harness/src/checkout";

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

export const E2E_STATE = e2eStateOf(REPO);
export const E2E_USER = "harakiri";
export const E2E_PASSWORD = "harakiri-dev";

let derived: E2eServer | undefined;

/**
 * This checkout's e2e container. The app probes UDP 7359 at HARAKIRI_DISCOVERY_ADDRESS, and the
 * container answers on a loopback address of its own, so the probe reaches neither a dev container
 * on 127.0.0.1:7359 nor another checkout's e2e server, and 127.0.0.2 stays the address where
 * nothing answers. Derived on first use, so a run against HARAKIRI_E2E_SERVER never reads
 * HARAKIRI_E2E_PORT.
 */
export const e2eServer = (): E2eServer => {
  derived ??= e2eServerFor(REPO);

  return derived;
};

/** What jellyfin.sh and bootstrap.ts need to run the e2e container; `mise run e2e:down` repeats it. */
export const e2eContainerEnv = () => {
  const server = e2eServer();

  return {
    JELLYFIN_DEV_NAME: server.name,
    JELLYFIN_DEV_PORT: String(server.port),
    JELLYFIN_DEV_DISCOVERY_ADDRESS: server.discoveryAddress,
    JELLYFIN_DEV_STATE: E2E_STATE,
    JELLYFIN_DEV_MEMORY: "2g",
    JELLYFIN_DEV_LIBRARY: "corpus",
    JELLYFIN_DEV_URL: server.url,
    JELLYFIN_DEV_USER: E2E_USER,
    JELLYFIN_DEV_PASSWORD: E2E_PASSWORD,
    HARAKIRI_CORPUS_DIR: CORPUS_DIR,
  } as const;
};

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

  const { url, discoveryAddress } = e2eServer();
  const server = ServerUrl.parse(url);

  return {
    kind: "corpus",
    server,
    address: new URL(server).host,
    user: E2E_USER,
    password: E2E_PASSWORD,
    discoveryAddress,
  };
};
