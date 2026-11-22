import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  // Each test launches Electron, and the player specs start mpv on real media files.
  timeout: 60_000,
  reporter: "list",
  // Generates the corpus when it is missing or stale, then starts the e2e Jellyfin on it. In the
  // dev/vm guest it only checks that the host half did.
  globalSetup: "./e2e/support/global-setup.ts",
  // `mise run e2e` runs `host` on the host under nested KWin, then `guest` inside the dev/vm guest.
  // Tag a describe `@host` only when it needs UDP to the host's loopback, which the guest cannot
  // reach. Tags count as part of the title for grep.
  projects: [
    { name: "host", grep: /@host/u },
    { name: "guest", grepInvert: /@host/u },
  ],
});
