import { existsSync } from "node:fs";

import { chromium } from "@playwright/test";

/**
 * Fails the browser tests loudly, naming the task that fixes it, when Playwright's pinned Chromium
 * is not installed. `mise run setup` installs it; `mise run check` never downloads it.
 */
export default function chromiumIsInstalled(): void {
  const executable = chromium.executablePath();

  if (!existsSync(executable)) {
    const message = `The browser tests run in Playwright's Chromium, which is not installed (${executable}). Run \`mise run setup\`, or \`mise run browser:install\` for the browser alone.`;
    // Vitest 5.0.5 crashes printing an error thrown from a global setup (vite's module runner
    // reads the source map wrong), and reports "No test files found" instead, so it is said here.
    process.stderr.write(`\n${message}\n\n`);
    throw new Error(message);
  }
}
