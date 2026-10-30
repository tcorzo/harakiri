import { resolve } from "node:path";
import { ServerUrl } from "@harakiri/jellyfin";
import {
  DEFAULT_USERS,
  type FakeJellyfin,
  startFakeJellyfin,
} from "../../../../packages/harness/src/fake-jellyfin/index";

/**
 * The Jellyfin the e2e runs against. By default each worker starts the in-process fake on the
 * generated corpus (packages/harness/src/fake-jellyfin), so a fresh clone needs no server and no
 * library. HARAKIRI_E2E_SERVER=<url> runs the same suite against a real server instead, signing in
 * as HARAKIRI_E2E_USER / HARAKIRI_E2E_PASSWORD (falling back to JELLYFIN_DEV_USER / _PASSWORD).
 */

export const REPO = resolve(import.meta.dirname, "../../../..");
export const CORPUS_DIR = process.env["HARAKIRI_CORPUS_DIR"] ?? resolve(REPO, ".cache/corpus");
export const REAL_SERVER = process.env["HARAKIRI_E2E_SERVER"];

export interface Backend {
  readonly kind: "fake" | "real";
  readonly server: ServerUrl;
  /** The address as an owner types it on the on-screen keyboard: host and port. */
  readonly address: string;
  readonly user: string;
  readonly password: string;
  /** Where HARAKIRI_DISCOVERY_ADDRESS points the app's UDP probe so this server answers it. */
  readonly discoveryAddress: string;
  /** The fake's state and request log; undefined against a real server. */
  readonly fake: FakeJellyfin | undefined;
  readonly close: () => Promise<void>;
}

const env = (...names: string[]) =>
  names.map((name) => process.env[name]).find((value) => value !== undefined && value !== "");

export async function startBackend(workerIndex: number): Promise<Backend> {
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
      fake: undefined,
      close: async () => {},
    };
  }
  // A loopback address of the worker's own, so the probe never reaches a dev container that
  // publishes 127.0.0.1:7359, and 127.0.0.2 stays the address where nothing answers.
  const discoveryAddress = `127.0.0.${3 + workerIndex}`;
  const fake = await startFakeJellyfin({
    corpusDir: CORPUS_DIR,
    discovery: { address: discoveryAddress },
  });
  const [user] = DEFAULT_USERS;
  if (user === undefined) throw new Error("The fake has no default user");
  return {
    kind: "fake",
    server: ServerUrl.parse(fake.url),
    address: fake.address,
    user: user.name,
    password: user.password,
    discoveryAddress,
    fake,
    close: fake.close,
  };
}
