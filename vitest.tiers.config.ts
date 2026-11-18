import { resolve } from "node:path";

import { type TestProjectInlineConfiguration, configDefaults, defineConfig } from "vitest/config";

import desktop from "./apps/desktop/vitest.config";
import harness from "./packages/harness/vitest.config";
import jellyfin from "./packages/jellyfin/vitest.config";
import { TIERS } from "./vitest.shared";

/**
 * The opt-in tiers (see vitest.shared.ts). Each project reuses its package's config but selects
 * only the tier's files. `vitest.config.ts`, the default run, never sees them.
 *   bun x vitest run --config vitest.tiers.config.ts --project 'live:*'
 */
const tier = (
  name: keyof typeof TIERS,
  project: string,
  dir: string,
  base: TestProjectInlineConfiguration
): TestProjectInlineConfiguration => ({
  ...base,
  // Spread instead of inheriting: `extends` concatenates arrays, so the package's
  // hermetic `exclude` would exclude the tier.
  extends: false,
  root: resolve(import.meta.dirname, dir),
  test: {
    ...base.test,
    name: `${name}:${project}`,
    include: [TIERS[name]],
    exclude: configDefaults.exclude,
  },
});

export default defineConfig({
  test: {
    projects: [
      tier("live", "jellyfin", "packages/jellyfin", jellyfin),
      tier("live", "desktop", "apps/desktop", desktop),
      tier("contract", "jellyfin", "packages/jellyfin", jellyfin),
      tier("fate", "harness", "packages/harness", harness),
    ],
  },
});
