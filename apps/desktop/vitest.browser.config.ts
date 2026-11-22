import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * Renderer component tests in a real headless Chromium, for what needs layout: d-pad focus moves
 * by element geometry, and sizes and positions come from the real stylesheet. Only
 * `*.browser.test.tsx` runs here; every other renderer test stays in happy-dom (vitest.config.ts).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    name: "desktop-browser",
    include: ["src/renderer/**/*.browser.test.tsx"],
    setupFiles: ["src/renderer/src/test/browser-setup.ts"],
    globalSetup: ["vitest.browser.global.ts"],
    browser: {
      enabled: true,
      headless: true,
      // The full Chromium in its new headless mode, the same browser Electron embeds, rather than
      // Playwright's separate headless shell.
      provider: playwright({ launchOptions: { channel: "chromium" } }),
      instances: [{ browser: "chromium" }],
      // A 1080p TV: the stylesheet sizes rem from the screen height, so this is a 16px rem.
      viewport: { width: 1920, height: 1080 },
    },
  },
});
