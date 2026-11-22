import { requireGuest } from "./guest";

/** The platform tier's vitest globalSetup: fails the run before any worker starts, outside the guest. */
export default function setup(): void {
  try {
    requireGuest("mise run test:platform");
  } catch (error) {
    // Vitest 5 crashes while source-mapping a globalSetup stack and prints no message. A plain
    // stack keeps the guard's message on screen.
    if (error instanceof Error) {
      error.stack = `${error.name}: ${error.message}`;
    }

    throw error;
  }
}
