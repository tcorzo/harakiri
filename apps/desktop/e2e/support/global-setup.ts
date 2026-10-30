import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CATALOG } from "../../../../packages/harness/src/corpus/catalog";
import { fateState } from "../../../../packages/harness/src/corpus/fate";
import { MANIFEST, readManifest } from "../../../../packages/harness/src/corpus/generate";
import { CORPUS_DIR, REAL_SERVER, REPO } from "./backend";

const FATE_DIR = process.env["HARAKIRI_FATE_DIR"] ?? resolve(REPO, ".cache/fate");

/** Why the corpus must be (re)generated before the fake can serve it, or null when it is current. */
function staleness(): string | null {
  if (!existsSync(resolve(CORPUS_DIR, MANIFEST))) return `no corpus in ${CORPUS_DIR}`;
  const manifest = readManifest(CORPUS_DIR);
  const built = new Set(manifest.entries.map((entry) => entry.id));
  const missing = CATALOG.filter((entry) => entry.tier === "base" && !built.has(entry.id));
  if (missing.length > 0) return `the corpus lacks ${missing.map((entry) => entry.id).join(", ")}`;
  if (!manifest.fate && fateState(FATE_DIR).kind === "complete")
    return "the FATE samples arrived after the corpus was built";
  return null;
}

/**
 * Before any worker starts the fake Jellyfin: generates the corpus when it is missing or older
 * than the catalog. FATE samples are not fetched here (that is network); `mise run e2e` fetches
 * them first, and without them the TrueHD Atmos test fails naming `mise run media:fetch-fate`.
 */
export default function globalSetup(): void {
  if (REAL_SERVER !== undefined && REAL_SERVER !== "") return;
  const why = staleness();
  if (why === null) return;
  console.log(`e2e: ${why}; generating it (mise run media:gen)`);
  const result = spawnSync(
    resolve(REPO, "scripts/bounded.sh"),
    ["corpus", "2G", "--", "bun", "packages/harness/src/corpus/cli.ts", "gen", "--out", CORPUS_DIR],
    { cwd: REPO, stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`Generating the corpus failed (exit ${result.status}); run mise run media:gen`);
  }
}
