import type { EnvFacts } from "../facts";

/** The launcher's own words for the add: where to launch harakiri, and what to do after a time-out. */
export interface LauncherHints {
  readonly launchHint: string;
  readonly retryHint: string;
}

/**
 * Inside a gamescope session harakiri already runs in Game Mode, under a running Steam, so the
 * words neither send the owner to Game Mode nor tell them to open Steam.
 */
export const steamHints = (env: EnvFacts): LauncherHints =>
  env.gamescopeDisplay === undefined
    ? {
        launchHint: "Launch it from there in Game Mode.",
        retryHint: "Open Steam, then try again.",
      }
    : {
        launchHint: "Launch it from there next time.",
        retryHint: "Try again in a moment.",
      };
