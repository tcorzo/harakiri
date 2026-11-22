import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { bundledMpv } from "@harakiri/mpv";
import { z } from "zod";

import { CATALOG } from "../../../../packages/harness/src/corpus/catalog";
import { fateState } from "../../../../packages/harness/src/corpus/fate";
import { MANIFEST, readManifest } from "../../../../packages/harness/src/corpus/generate";
import { inGuest } from "../../../../packages/harness/src/guest";
import { CORPUS_DIR, E2E_CONTAINER_ENV, E2E_SERVER, REAL_SERVER, REPO } from "./backend";

const FATE_DIR = process.env.HARAKIRI_FATE_DIR ?? path.resolve(REPO, ".cache/fate");
const STATE = E2E_CONTAINER_ENV.JELLYFIN_DEV_STATE;

/** The corpus manifest the container last finished scanning; a different one recreates it. */
const SCANNED = path.resolve(STATE, "corpus.sha256");
const SERVER = E2E_CONTAINER_ENV.JELLYFIN_DEV_URL;

/** Why the corpus must be (re)generated before the server can scan it, or null when it is current. */
const staleness = (): string | null => {
  if (!existsSync(path.resolve(CORPUS_DIR, MANIFEST))) {
    return `no corpus in ${CORPUS_DIR}`;
  }

  const manifest = readManifest(CORPUS_DIR);
  const built = new Set(manifest.entries.map((entry) => entry.id));
  const missing = CATALOG.filter((entry) => entry.tier === "base" && !built.has(entry.id));

  if (missing.length > 0) {
    return `the corpus lacks ${missing.map((entry) => entry.id).join(", ")}`;
  }

  if (!manifest.fate && fateState(FATE_DIR).kind === "complete") {
    return "the FATE samples arrived after the corpus was built";
  }

  return null;
};

const run = (what: string, command: string, args: readonly string[]): void => {
  const result = spawnSync(command, args, {
    cwd: REPO,
    stdio: "inherit",
    env: { ...process.env, ...E2E_CONTAINER_ENV },
  });

  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`${what} failed (${result.error?.message ?? `exit ${result.status}`})`);
  }
};

const jellyfinSh = (command: string) => {
  run(`jellyfin.sh ${command}`, path.resolve(REPO, "dev/jellyfin/jellyfin.sh"), [command]);
};

/**
 * Each request to the e2e Jellyfin gets this long. A server that accepts the connection and never
 * answers would otherwise hang the setup with no message. A busy scan still answers in well under
 * a second.
 */
const REQUEST_TIMEOUT_MS = 10_000;

const AUTH =
  'MediaBrowser Client="harakiri-e2e-setup", Device="setup", DeviceId="harakiri-e2e-setup", Version="0"';

const get = async <Schema extends z.ZodType>(
  schema: Schema,
  route: string,
  token: string
): Promise<z.infer<Schema>> => {
  const response = await fetch(new URL(route, SERVER), {
    headers: { Authorization: `${AUTH}, Token="${token}"` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`GET ${route}: HTTP ${response.status}`);
  }

  return schema.parse(await response.json());
};

/** Waits until the library scan is idle and has found every file in the corpus. */
const waitForScan = async (expected: number, timeoutMs = 180_000): Promise<void> => {
  const signIn = await fetch(new URL("Users/AuthenticateByName", SERVER), {
    method: "POST",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({
      Username: E2E_CONTAINER_ENV.JELLYFIN_DEV_USER,
      Pw: E2E_CONTAINER_ENV.JELLYFIN_DEV_PASSWORD,
    }),
    // Signing in hashes the password server-side, the slowest call here; it gets twice as long.
    signal: AbortSignal.timeout(2 * REQUEST_TIMEOUT_MS),
  });

  if (!signIn.ok) {
    throw new Error(`Signing in to the e2e Jellyfin: HTTP ${signIn.status}`);
  }

  const { AccessToken: token } = z.object({ AccessToken: z.string() }).parse(await signIn.json());
  const deadline = Date.now() + timeoutMs;
  let last = "";

  /* oxlint-disable eslint/no-await-in-loop -- the scan is polled one round at a time */
  while (Date.now() < deadline) {
    const counts = await get(
      z.object({ MovieCount: z.number(), EpisodeCount: z.number() }),
      "Items/Counts",
      token
    );

    const tasks = await get(
      z.array(z.object({ Key: z.string(), State: z.string() })),
      "ScheduledTasks?isHidden=false",
      token
    );

    const scan = tasks.find((task) => task.Key === "RefreshLibrary")?.State ?? "missing";
    const found = counts.MovieCount + counts.EpisodeCount;

    if (found === expected && scan === "Idle") {
      return;
    }

    last = `${found} of ${expected} items, scan ${scan}`;
    await sleep(500);
  }
  /* oxlint-enable eslint/no-await-in-loop */

  throw new Error(`The e2e Jellyfin did not finish scanning the corpus: ${last}`);
};

const fingerprintOf = (corpusDir: string): string =>
  createHash("sha256")
    .update(readFileSync(path.resolve(corpusDir, MANIFEST)))
    .digest("hex");

/** Why the e2e Jellyfin cannot serve this corpus as it is, or null when it can. */
const unprepared = async (): Promise<string | null> => {
  if (!existsSync(SCANNED)) {
    return "no scan recorded";
  }

  try {
    if (readFileSync(SCANNED, "utf-8").trim() !== fingerprintOf(CORPUS_DIR)) {
      return "scanned another corpus";
    }

    await waitForScan(readManifest(CORPUS_DIR).entries.length, 10_000);
  } catch (error) {
    // fetch() says only "fetch failed"; the refused connection is its cause.
    return error instanceof Error && error.cause instanceof Error
      ? `${error.message}: ${error.cause.message}`
      : String(error instanceof Error ? error.message : error);
  }

  return null;
};

/**
 * In the dev/vm guest: the host half of `mise run e2e` has already started the container and
 * scanned the corpus, and the guest has no podman. It only checks that the server is ready, and
 * fails at once when it is not, instead of after a Playwright timeout.
 */
const expectPrepared = async (): Promise<void> => {
  const reason = await unprepared();

  if (reason !== null) {
    throw new Error(
      `The e2e Jellyfin at ${SERVER} is not ready for this corpus (${reason}). \`mise run e2e\` prepares it on the host before the guest runs.`
    );
  }
};

const Inspected = z.array(
  z.object({
    State: z.object({ Running: z.boolean() }),
    HostConfig: z.object({
      PortBindings: z.record(
        z.string(),
        z.array(z.object({ HostIp: z.string(), HostPort: z.string() })).nullable()
      ),
    }),
  })
);

/** This checkout's e2e container as podman sees it, or undefined when there is none. */
const inspectContainer = () => {
  const result = spawnSync("podman", ["container", "inspect", E2E_SERVER.name], {
    encoding: "utf-8",
  });

  return result.status === 0 ? Inspected.parse(JSON.parse(result.stdout))[0] : undefined;
};

/** Whether something on the host already listens on 127.0.0.1:<port>. */
const portTaken = async (port: number): Promise<boolean> => {
  const server = createServer();

  try {
    server.listen(port, "127.0.0.1");
    // once() rejects when the server emits "error" first.
    await once(server, "listening");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EADDRINUSE") {
      return true;
    }

    throw error;
  }

  server.close();
  await once(server, "close");

  return false;
};

/**
 * Makes sure `jellyfin.sh up` can start this checkout's container where the suite looks for it.
 * A container whose state dir is gone, or that publishes another port or discovery address (say,
 * HARAKIRI_E2E_PORT changed), is removed so `up` recreates it. A running one is kept. Otherwise,
 * when another process holds the port, it fails naming the port and the way out, instead of
 * podman's bare "address already in use".
 */
const claimPort = async (): Promise<void> => {
  const container = inspectContainer();

  if (container !== undefined) {
    const http = container.HostConfig.PortBindings["8096/tcp"]?.[0];
    const discovery = container.HostConfig.PortBindings["7359/udp"]?.[0];

    if (
      !existsSync(STATE) ||
      http?.HostPort !== String(E2E_SERVER.port) ||
      discovery?.HostIp !== E2E_SERVER.discoveryAddress
    ) {
      console.log("e2e: the e2e Jellyfin container does not match this checkout; recreating it");
      jellyfinSh("down");
    } else if (container.State.Running) {
      return;
    }
  }

  if (await portTaken(E2E_SERVER.port)) {
    throw new Error(
      `Port ${E2E_SERVER.port} on 127.0.0.1, where this checkout's e2e Jellyfin (${E2E_SERVER.name}) listens, is held by another process. Its port derives from the checkout's path. Stop that process (\`ss -ltnp 'sport = :${E2E_SERVER.port}'\` names it), or set HARAKIRI_E2E_PORT to a free port.`
    );
  }
};

/**
 * Before any test: generates the corpus when it is missing or older than the catalog, then makes
 * sure the e2e Jellyfin container is up, bootstrapped and done scanning it. A running container
 * whose last scan matches the corpus manifest is reused as it is; a changed corpus recreates it
 * from empty state. FATE samples are not fetched here (that is network); `mise run e2e` fetches
 * them first, and without them the TrueHD Atmos test fails naming `mise run media:fetch-fate`.
 * In the dev/vm guest it starts nothing, and only checks what the host half prepared.
 * First of all, every spec plays with harakiri's mpv build, so a missing one fails the run at
 * once, naming `mise run mpv:build`, before anything starts.
 */
export default async function globalSetup(): Promise<void> {
  bundledMpv();

  if (REAL_SERVER !== undefined && REAL_SERVER !== "") {
    return;
  }

  if (inGuest()) {
    await expectPrepared();

    return;
  }

  if (spawnSync("podman", ["--version"]).error !== undefined) {
    throw new Error(
      "The e2e suite runs a real Jellyfin in podman, and podman is not installed. Install it (Fedora: sudo dnf install podman), or point HARAKIRI_E2E_SERVER at a running Jellyfin."
    );
  }

  const why = staleness();

  if (why !== null) {
    console.log(`e2e: ${why}; generating it (mise run media:gen)`);
    run("Generating the corpus (mise run media:gen)", path.resolve(REPO, "scripts/bounded.sh"), [
      "corpus",
      "2G",
      "--",
      "bun",
      "packages/harness/src/corpus/cli.ts",
      "gen",
      "--out",
      CORPUS_DIR,
    ]);
  }

  const fingerprint = fingerprintOf(CORPUS_DIR);
  const scanned = existsSync(SCANNED) ? readFileSync(SCANNED, "utf-8").trim() : undefined;

  if (scanned !== fingerprint && existsSync(STATE)) {
    console.log("e2e: the corpus changed since the e2e Jellyfin scanned it; recreating it");
    jellyfinSh("reset");
  }

  await claimPort();
  jellyfinSh("up");
  run("Bootstrapping the e2e Jellyfin", "bun", ["dev/jellyfin/bootstrap.ts"]);
  await waitForScan(readManifest(CORPUS_DIR).entries.length);
  writeFileSync(SCANNED, `${fingerprint}\n`);
}
