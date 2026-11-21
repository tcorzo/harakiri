import type { HdrSignalling } from "@harakiri/fidelity";

import type { HostFacts } from "./facts";

/** Where a secret such as the access token can be kept: an OS keyring, or a 0600 file. */
export type SecretStore = "keyring" | "file";

/** What the host can do, named by behaviour. Features ask these, never which platform it is. */
export interface HostCapabilities {
  readonly secretStore: SecretStore;
  /** How the compositor takes HDR from mpv, which decides mpv's colorspace hint. */
  readonly hdrSignalling: HdrSignalling;
}

// Contract stub: Task 5 of the plan replaces this body with the rules. These values keep today's
// behaviour: the session store does not ask yet, and "colour-management" gives mpv's "auto" hint.
export const capabilitiesOf = (_facts: HostFacts): HostCapabilities => ({
  secretStore: "keyring",
  hdrSignalling: "colour-management",
});
