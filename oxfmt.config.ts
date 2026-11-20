import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  printWidth: 100,
  proseWrap: "preserve",
  ignorePatterns: [
    ...ultracite.ignorePatterns,
    "packages/jellyfin/src/generated/**",
    "packages/jellyfin/openapi/**",
    "bun.lock",
    "mise.lock",
    "**/.impeccable/**",
    "**/routeTree.gen.ts",
  ],
});
