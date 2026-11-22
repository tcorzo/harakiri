import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/desktop", "apps/desktop/vitest.browser.config.ts"],
  },
});
