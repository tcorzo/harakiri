import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

const { version } = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "package.json"), "utf8"),
) as { version: string };

export default defineConfig({
  plugins: [react()],
  // The same build-time version the bundles get (electron.vite.config.ts).
  define: { HARAKIRI_APP_VERSION: JSON.stringify(version) },
  test: {
    name: "desktop",
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
    // hermeticExclude from vitest.shared.ts, spelled out: tsconfig.node.json keeps this file's
    // imports inside apps/desktop.
    exclude: [
      ...configDefaults.exclude,
      "**/*.live.test.{ts,tsx}",
      "**/*.contract.test.{ts,tsx}",
      "**/*.fate.test.{ts,tsx}",
    ],
  },
});
