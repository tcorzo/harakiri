#!/usr/bin/env bun
/**
 * Fails when a text file holds data from the owner's workstation: machine paths, the owner's
 * domains, or titles and release tags from the owner's media library. The repo is public, and a
 * file name with a release tag in it says more than any test needs.
 *
 *   bun scripts/lint-private.ts            every file git tracks or would track
 *   bun scripts/lint-private.ts <file>...  only these (hk pre-commit passes the staged ones)
 *
 * The generic rules always apply. Library titles cannot be listed here without publishing them,
 * so they come from `.private-denylist` at the repo root when it exists: gitignored, one fixed
 * string per line, matched as a whole word in any case, `#` starts a comment.
 *
 * A line may match only with an approved, dated exception on the same line:
 *   // allow-private: <reason> (expires YYYY-MM-DD, approved-by <name>)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

interface Rule {
  name: string;
  pattern: RegExp;
}

// Spelled so this file does not match itself.
const GENERIC: Rule[] = [
  { name: "NAS mount path", pattern: new RegExp(["", "mnt", ""].join("/"), "u") },
  { name: "NAS name", pattern: new RegExp(["true", "nas"].join(""), "iu") },
  { name: "home directory", pattern: new RegExp(["", "home", "[^/\\s\"'`]+"].join("/"), "u") },
  { name: "agent scratchpad path", pattern: new RegExp(["", "tmp", "claude-"].join("/"), "u") },
  { name: "owner domain", pattern: new RegExp(["tcorzo", "dev"].join("\\."), "iu") },
  {
    name: "impeccable live session token",
    pattern: new RegExp(["live", "js\\?token=[0-9a-f]{8}-"].join("\\."), "iu"),
  },
];

const DENYLIST = ".private-denylist";
const ALLOW = /\/\/\s*allow-private:/u;

const ALLOW_FULL =
  /\/\/\s*allow-private:\s*(?<reason>\S.*?)\s*\(expires (?<date>\d{4}-\d{2}-\d{2}), approved-by (?<name>\S[^)]*)\)/u;

const RULE =
  "the repo must not carry data from the owner's workstation or media library. " +
  "Read machine paths and server addresses from env vars or a gitignored .env, take media from " +
  "the generated corpus (packages/harness/src/corpus) instead of the owner's files, and give " +
  'fixtures and tests neutral invented names ("Fixture DV5 E-AC3", /media/movies/fixture-dv5-eac3.mkv). ' +
  "Recorders scrub what they record. A temporary exception needs, on the same line: " +
  "// allow-private: <reason> (expires YYYY-MM-DD, approved-by <name>)";

const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const denied = (): Rule[] =>
  existsSync(DENYLIST)
    ? readFileSync(DENYLIST, "utf-8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"))
        .map((term) => ({
          name: "library title or release tag from .private-denylist",
          pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, "iu"),
        }))
    : [];

const tracked = (): string[] =>
  execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf-8",
  })
    .split("\0")
    // A file deleted or renamed in the working tree stays listed until it is staged.
    .filter((file) => file !== "" && existsSync(file));

const isRealDate = (date: string) => {
  const parsed = new Date(`${date}T00:00:00Z`);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
};

/** Text, or undefined for a binary file (a NUL byte in its first 8 KiB). */
const readText = (file: string): string | undefined => {
  const bytes = readFileSync(file);

  return bytes.subarray(0, 8192).includes(0) ? undefined : bytes.toString("utf-8");
};

const today = new Date().toISOString().slice(0, 10);
const args = process.argv.slice(2);
const files = (args.length > 0 ? args : tracked()).filter((file) => existsSync(file));
const rules = [...GENERIC, ...denied()];

/** Why this line breaks the rule, or undefined when it matches nothing or holds a live exception. */
const judge = (line: string): string | undefined => {
  const hits = rules.flatMap(({ name, pattern }) => (pattern.test(line) ? [name] : []));

  if (hits.length === 0) {
    return undefined;
  }

  const what = [...new Set(hits)].join(", ");

  if (!ALLOW.test(line)) {
    return `${what}, without an allow-private exception`;
  }

  const allow = ALLOW_FULL.exec(line)?.groups;
  const date = allow?.date;

  if (date === undefined || !isRealDate(date)) {
    return "malformed exception; write // allow-private: <reason> (expires YYYY-MM-DD, approved-by <name>)";
  }

  if (date < today) {
    return `exception expired on ${date} (approved by ${allow?.name}); remove the data or renew the approval`;
  }

  return undefined;
};

const problems: string[] = [];

for (const file of files) {
  const text = readText(file);

  if (text === undefined) {
    continue;
  }

  for (const [index, line] of text.split("\n").entries()) {
    const why = judge(line);

    if (why !== undefined) {
      problems.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}\n  ${why}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`lint-private: ${problems.length} line(s) with workstation or library data\n`);

  for (const problem of problems) {
    console.error(`${problem}\n`);
  }

  console.error(`Rule: ${RULE}`);
  process.exit(1);
}

const source = existsSync(DENYLIST) ? `, ${rules.length - GENERIC.length} denylist term(s)` : "";

console.log(`lint-private: ${files.length} file(s), none private${source}`);
