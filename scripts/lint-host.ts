#!/usr/bin/env bun
/**
 * Fails when feature code names a platform or reads the host environment. Features ask host
 * capabilities (apps/desktop/src/main/host); only that directory may know which desktop,
 * compositor or store the app runs under.
 *
 *   bun scripts/lint-host.ts            every tracked or untracked .ts and .tsx file in scope
 *   bun scripts/lint-host.ts <file>...  only these (hk pre-commit passes the staged ones)
 *
 * There is no exception comment: a hit moves into host/ or is reworded.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

interface Rule {
  name: string;
  pattern: RegExp;
}

// Spelled so this file does not match itself.
const RULES: Rule[] = [
  {
    name: "host environment read",
    pattern: new RegExp(
      `\\b(?:${["XDG_[A-Z_]+", "GAMESCOPE_[A-Z_]+", "WAYLAND_DISPLAY", "LD_PRELOAD"].join("|")})\\b`,
      "u"
    ),
  },
  {
    name: "keyring backend probe",
    pattern: new RegExp(`\\b${["getSelected", "StorageBackend"].join("")}\\b`, "u"),
  },
  {
    name: "platform name",
    pattern: new RegExp(
      [["game", "scope"].join(""), ["k", "win"].join(""), `\\b${["ste", "am"].join("")}`].join("|"),
      "iu"
    ),
  },
];

/** Where the rules apply. */
const SCOPE = [/^apps\/desktop\/src\/.+\.tsx?$/u, /^packages\/[^/]+\/src\/.+\.tsx?$/u];

/** Where they do not. The Add to Steam plan extends this list. */
const EXEMPT = [
  /^apps\/desktop\/src\/main\/host\//u,
  /\.test\.tsx?$/u,
  /(?:^|\/)fixtures\//u,
  /^packages\/harness\//u,
  /^packages\/fidelity\/src\/scenarios\.ts$/u,
];

const RULE =
  "feature code must not name a platform or read the host environment. " +
  "Ask a host capability (apps/desktop/src/main/host) instead and put the platform knowledge " +
  "there, or reword the comment.";

const tracked = (): string[] =>
  execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf-8",
  })
    .split("\0")
    // A file deleted or renamed in the working tree stays listed until it is staged.
    .filter((file) => file !== "" && existsSync(file));

const args = process.argv.slice(2);

const files = (args.length > 0 ? args : tracked()).filter(
  (file) =>
    existsSync(file) &&
    SCOPE.some((scope) => scope.test(file)) &&
    !EXEMPT.some((exempt) => exempt.test(file))
);

const problems: string[] = [];

for (const file of files) {
  for (const [index, line] of readFileSync(file, "utf-8").split("\n").entries()) {
    const hits = RULES.flatMap(({ name, pattern }) => (pattern.test(line) ? [name] : []));

    if (hits.length > 0) {
      problems.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}\n  ${hits.join(", ")}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`lint-host: ${problems.length} line(s) naming a platform\n`);

  for (const problem of problems) {
    console.error(`${problem}\n`);
  }

  console.error(`Rule: ${RULE}`);
  process.exit(1);
}

console.log(`lint-host: ${files.length} file(s), none name a platform`);
