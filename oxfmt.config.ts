import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  printWidth: 100,
  proseWrap: "preserve",
  ignorePatterns: [
    // apps/desktop/build holds electron-builder resources and the Steam art renderer's source;
    // build output goes to out/ and dist/, which the preset already ignores.
    ...(ultracite.ignorePatterns ?? []).filter((pattern) => pattern !== "**/build"),
    "packages/jellyfin/src/generated/**",
    "packages/jellyfin/openapi/**",
    "bun.lock",
    "mise.lock",
    // release-please writes these on every release; formatting them would fight it.
    "CHANGELOG.md",
    ".release-please-manifest.json",
    "**/.impeccable/**",
    "**/routeTree.gen.ts",
  ],
});
