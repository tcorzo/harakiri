import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod";

import { CATALOG } from "../../../../packages/harness/src/corpus/catalog";
import { fateState } from "../../../../packages/harness/src/corpus/fate";
import { MANIFEST, readManifest } from "../../../../packages/harness/src/corpus/generate";
import { CORPUS_DIR, E2E_CONTAINER_ENV, REAL_SERVER, REPO } from "./backend";

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

const AUTH =
  'MediaBrowser Client="harakiri-e2e-setup", Device="setup", DeviceId="harakiri-e2e-setup", Version="0"';

const get = async <Schema extends z.ZodType>(
  schema: Schema,
  route: string,
  token: string
): Promise<z.infer<Schema>> => {
  const response = await fetch(new URL(route, SERVER), {
    headers: { Authorization: `${AUTH}, Token="${token}"` },
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

/**
 * Before any test: generates the corpus when it is missing or older than the catalog, then makes
 * sure the e2e Jellyfin container is up, bootstrapped and done scanning it. A running container
 * whose last scan matches the corpus manifest is reused as it is; a changed corpus recreates it
 * from empty state. FATE samples are not fetched here (that is network); `mise run e2e` fetches
 * them first, and without them the TrueHD Atmos test fails naming `mise run media:fetch-fate`.
 */
export default async function globalSetup(): Promise<void> {
  if (REAL_SERVER !== undefined && REAL_SERVER !== "") {
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

  const manifest = readFileSync(path.resolve(CORPUS_DIR, MANIFEST));
  const fingerprint = createHash("sha256").update(manifest).digest("hex");
  const scanned = existsSync(SCANNED) ? readFileSync(SCANNED, "utf-8").trim() : undefined;

  if (scanned !== fingerprint && existsSync(STATE)) {
    console.log("e2e: the corpus changed since the e2e Jellyfin scanned it; recreating it");
    jellyfinSh("reset");
  }

  jellyfinSh("up");
  run("Bootstrapping the e2e Jellyfin", "bun", ["dev/jellyfin/bootstrap.ts"]);
  await waitForScan(readManifest(CORPUS_DIR).entries.length);
  writeFileSync(SCANNED, `${fingerprint}\n`);
}
