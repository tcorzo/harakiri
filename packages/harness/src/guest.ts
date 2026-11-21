import { existsSync } from "node:fs";

/** Written into the dev/vm guest image. Its presence is how a test knows it runs in the guest. */
export const GUEST_MARKER = "/etc/harakiri-guest";

export const inGuest = (marker: string = GUEST_MARKER): boolean => existsSync(marker);

/** Throws, naming the mise task that runs the platform tier, when this is not the dev/vm guest. */
export const requireGuest = (task: string, marker: string = GUEST_MARKER): void => {
  if (!inGuest(marker)) {
    throw new Error(`This test runs inside the dev/vm guest. Run it with \`${task}\`.`);
  }
};
