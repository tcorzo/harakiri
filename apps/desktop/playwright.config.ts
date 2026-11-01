import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  // Each test launches Electron, and the player specs start mpv on real media files.
  timeout: 60_000,
  reporter: "list",
  // Generates the corpus when it is missing or stale, then starts the e2e Jellyfin on it.
  globalSetup: "./e2e/support/global-setup.ts",
});
