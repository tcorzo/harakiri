import type { HdrSignalling } from "@harakiri/fidelity";

import type { EnvFacts, HostFacts, SteamFacts } from "./facts";
import { shortcutFor } from "./steam/shortcuts-vdf";

/** Where a secret such as the access token can be kept: an OS keyring, or a 0600 file. */
export type SecretStore = "keyring" | "file";

/** What the host can do, named by behaviour. Features ask these, never which platform it is. */
export interface HostCapabilities {
  readonly secretStore: SecretStore;
  /** How the compositor takes HDR from mpv, which decides mpv's colorspace hint. */
  readonly hdrSignalling: HdrSignalling;
}

const weakBackends: ReadonlySet<string> = new Set(["basic_text", "unknown"]);

/**
 * A keyring needs working encryption and a real backend: Electron's `basic_text` and `unknown`
 * keep the secret behind a key anyone can read.
 */
const secretStoreOf = (facts: HostFacts): SecretStore =>
  facts.encryptionAvailable && !weakBackends.has(facts.secretBackend) ? "keyring" : "file";

/**
 * Only a client on gamescope's own Wayland display takes HDR from the swapchain's formats. A
 * Wayland client nested in another compositor goes through colour management.
 */
export const hdrSignallingOf = (facts: EnvFacts): HdrSignalling =>
  facts.gamescopeDisplay !== undefined &&
  (facts.waylandDisplay === undefined || facts.waylandDisplay === facts.gamescopeDisplay)
    ? "swapchain-formats"
    : "colour-management";

/** Whether Steam is here, and whether harakiri is already one of its shortcuts. */
export type SteamLibrary = "absent" | "present" | "has-harakiri";

/** absent: no root or no users. has-harakiri: some user has a shortcut that runs `script`. */
export const steamLibraryOf = (steam: SteamFacts, script: string): SteamLibrary => {
  if (steam.root === undefined || steam.users.length === 0) {
    return "absent";
  }

  return steam.users.some((user) => shortcutFor(user.shortcuts, script) !== undefined)
    ? "has-harakiri"
    : "present";
};

export const capabilitiesOf = (facts: HostFacts): HostCapabilities => ({
  secretStore: secretStoreOf(facts),
  hdrSignalling: hdrSignallingOf(facts),
});
