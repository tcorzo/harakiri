import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import playwright from "ultracite/oxlint/playwright";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";
import vitest from "ultracite/oxlint/vitest";

// A root override cannot reach rules the vitest preset sets inside its own overrides.
const vitestRules = {
  // Tests assert literal values: toBe(true) must not loosen to toBeTruthy().
  "vitest/prefer-to-be-falsy": "off",
  "vitest/prefer-to-be-truthy": "off",
  // e2e specs follow Playwright's *.spec.ts; vitest.shared.ts selects tiers by file name.
  "vitest/consistent-test-filename": "off",
} as const;

export default defineConfig({
  env: core.env,
  extends: [
    core,
    react,
    tanstack,
    {
      ...vitest,
      overrides: vitest.overrides?.map((o) => ({ ...o, rules: { ...o.rules, ...vitestRules } })),
    },
    playwright,
    antiSlop,
  ],
  ignorePatterns: [
    // apps/desktop/build holds electron-builder resources and the Steam art renderer's source, so
    // the preset's `**/build` would hide real code from lint. Build output goes to out/ and dist/.
    ...(core.ignorePatterns ?? []).filter((pattern) => pattern !== "**/build"),
    "**/out/**",
    "**/dist/**",
    "**/.tsbuild/**",
    "packages/jellyfin/src/generated/**",
    "**/.impeccable/**",
  ],
  options: { typeAware: true },
  rules: {
    // A zod schema and its inferred type share a name; tsc rejects real redeclarations.
    "no-redeclare": "off",
  },
  overrides: [
    {
      // Playwright fixtures call use(), which is not React's hook.
      files: ["apps/desktop/e2e/**"],
      rules: { "react/rules-of-hooks": "off" },
    },
    {
      // IEC 61937, RIFF and PGS are bit-level formats.
      files: [
        "packages/harness/src/audio/iec61937*.ts",
        "packages/harness/src/audio/wav*.ts",
        "packages/harness/src/audio/t0-golden.test.ts",
        "packages/harness/src/corpus/pgs.ts",
      ],
      rules: { "no-bitwise": "off" },
    },
    {
      // TanStack Router redirects by throwing redirect().
      files: ["**/routes/**/*.{ts,tsx}"],
      rules: { "typescript/only-throw-error": "off" },
    },
  ],
});
