#!/usr/bin/env bun
/**
 * Fails when a test file can skip. A skipped test proves nothing while the run looks green, so a
 * test that needs the dev Jellyfin or the FATE samples belongs in a tier (`*.live.test.ts`,
 * `*.contract.test.ts`, `*.fate.test.ts`, see vitest.shared.ts) that fails when its dependency
 * is missing.
 *
 *   bun scripts/lint-skips.ts            every test file git tracks or would track
 *   bun scripts/lint-skips.ts <file>...  only these (hk pre-commit passes the staged ones)
 *
 * A line may skip only with an approved, dated exception on the same line:
 *   // allow-skip: <reason> (expires YYYY-MM-DD, approved-by <name>)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const TEST_FILE = /\.(test|spec)\.tsx?$/;
const SKIP = /\b(?:skipIf|runIf)\(|\.skip\(|\b(?:test|describe|it)\.skip\b|\.todo\(/;
const ALLOW = /\/\/\s*allow-skip:/;
const ALLOW_FULL =
  /\/\/\s*allow-skip:\s*(?<reason>\S.*?)\s*\(expires (?<date>\d{4}-\d{2}-\d{2}), approved-by (?<name>\S[^)]*)\)/;

const RULE =
  "tests must not skip: a skipped test proves nothing while the run stays green. " +
  "Move a test that needs the dev Jellyfin or FATE samples into a tier file " +
  "(*.live.test.ts, *.contract.test.ts or *.fate.test.ts) and throw when the dependency is " +
  "missing, naming the mise task that provides it. A temporary exception needs, on the same line: " +
  "// allow-skip: <reason> (expires YYYY-MM-DD, approved-by <name>)";

const tracked = (): string[] =>
  execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "*.test.ts",
      "*.test.tsx",
      "*.spec.ts",
      "*.spec.tsx",
    ],
    {
      encoding: "utf8",
    },
  )
    .split("\0")
    // A file deleted or renamed in the working tree stays listed until it is staged.
    .filter((file) => file !== "" && existsSync(file));

const isRealDate = (date: string) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
};

const today = new Date().toISOString().slice(0, 10);
const args = process.argv.slice(2);
const files = (args.length > 0 ? args : tracked()).filter((file) => TEST_FILE.test(file));

/** Why this line breaks the rule, or undefined when it does not skip or holds a live exception. */
const judge = (line: string): string | undefined => {
  if (!SKIP.test(line)) return undefined;
  if (!ALLOW.test(line)) return "skips without an allow-skip exception";
  const allow = ALLOW_FULL.exec(line)?.groups;
  const date = allow?.["date"];
  if (date === undefined || !isRealDate(date))
    return "malformed exception; write // allow-skip: <reason> (expires YYYY-MM-DD, approved-by <name>)";
  if (date < today)
    return `exception expired on ${date} (approved by ${allow?.["name"]}); fix the test or renew the approval`;
  return undefined;
};

const problems: string[] = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    const why = judge(line);
    if (why) problems.push(`${file}:${index + 1}: ${line.trim()}\n  ${why}`);
  }
}

if (problems.length > 0) {
  console.error(`lint-skips: ${problems.length} skipping test line(s)\n`);
  for (const problem of problems) console.error(`${problem}\n`);
  console.error(`Rule: ${RULE}`);
  process.exit(1);
}
console.log(`lint-skips: ${files.length} test file(s), none skip`);
