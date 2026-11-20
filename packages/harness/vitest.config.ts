import { defineConfig } from "vitest/config";

import { hermeticExclude } from "../../vitest.shared";

export default defineConfig({
  test: {
    name: "harness",
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: hermeticExclude,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
