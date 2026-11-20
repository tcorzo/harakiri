import { readFileSync } from "node:fs";
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { z } from "zod";

const renderer = path.resolve(import.meta.dirname, "src/renderer/src");

const { version, dependencies } = z
  .object({ version: z.string(), dependencies: z.record(z.string(), z.string()) })
  .parse(JSON.parse(readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf-8")));

const workspacePackages = Object.keys(dependencies).filter((name) => name.startsWith("@harakiri/"));

// Run unpackaged, Electron reports its own version from app.getVersion(), so every bundle gets ours
// (src/shared/identity.ts).
const define = { HARAKIRI_APP_VERSION: JSON.stringify(version) };

export default defineConfig({
  main: {
    define,
    build: {
      // Workspace packages ship raw TypeScript, so they must be bundled rather than required at runtime.
      externalizeDeps: { exclude: workspacePackages },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads cannot load ESM or require npm modules, so ship one CommonJS bundle.
      externalizeDeps: false,
      rolldownOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  renderer: {
    define,
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: path.resolve(renderer, "routes"),
        generatedRouteTree: path.resolve(renderer, "routeTree.gen.ts"),
        quoteStyle: "double",
        semicolons: true,
      }),
      react(),
      tailwindcss(),
    ],
  },
});
