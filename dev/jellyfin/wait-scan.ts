// Follows the library scan until it finishes (or times out), then reports item and image counts.
// Run: mise exec -- bun dev/jellyfin/wait-scan.ts [timeoutMinutes=180]

import { setTimeout as sleep } from "node:timers/promises";

import { api, login, waitForServer } from "./client";

interface Task {
  Key: string;
  State: "Idle" | "Cancelling" | "Running";
  CurrentProgressPercentage?: number;
  LastExecutionResult?: { Status: string; EndTimeUtc: string };
}

interface Item {
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
}

interface Counts {
  MovieCount: number;
  SeriesCount: number;
  EpisodeCount: number;
}

const timeoutMin = Number(process.argv[2] ?? 180);
const POLL_MS = 15_000;

// The task may take a moment to enter Running after /Library/Refresh.
const IDLE_GRACE_MS = 45_000;

await waitForServer();

let auth = await login();
const { userId } = auth;

// Another login with the same DeviceId revokes our token; log in again once and retry.
const get = async <T>(route: string): Promise<T> => {
  try {
    return await api<T>("GET", route, { token: auth.token });
  } catch (error) {
    if (!String(error).includes("-> 401")) {
      throw error;
    }

    auth = await login();

    return await api<T>("GET", route, { token: auth.token });
  }
};

const counts = async (): Promise<Counts> => await get<Counts>(`/Items/Counts?userId=${userId}`);

const imageStats = async (type: string) => {
  const q = new URLSearchParams({
    IncludeItemTypes: type,
    Recursive: "true",
    EnableImageTypes: "Primary,Backdrop,Logo",
    EnableUserData: "false",
    userId,
  });

  const r = await get<{ Items: Item[]; TotalRecordCount: number }>(`/Items?${q.toString()}`);

  return {
    total: r.TotalRecordCount,
    primary: r.Items.filter((i) => (i.ImageTags?.Primary ?? "") !== "").length,
    backdrop: r.Items.filter((i) => (i.BackdropImageTags?.length ?? 0) > 0).length,
    logo: r.Items.filter((i) => (i.ImageTags?.Logo ?? "") !== "").length,
  };
};

const start = Date.now();
const deadline = start + timeoutMin * 60_000;
let seenRunning = false;
let finished = false;

/* oxlint-disable eslint/no-await-in-loop -- the poll is sequential: each round reads the state the previous one left */
while (Date.now() < deadline) {
  const tasks = await get<Task[]>("/ScheduledTasks?isHidden=false");
  const scan = tasks.find((t) => t.Key === "RefreshLibrary");
  const c = await counts();
  const elapsed = Math.round((Date.now() - start) / 60_000);
  const pct = scan?.CurrentProgressPercentage?.toFixed(1) ?? "-";
  console.log(
    `[${new Date().toISOString()} +${elapsed}m] scan ${scan?.State ?? "?"} ${pct}% | movies ${c.MovieCount} series ${c.SeriesCount} episodes ${c.EpisodeCount}`
  );

  if (scan?.State === "Running") {
    seenRunning = true;
  } else if (seenRunning || Date.now() - start > IDLE_GRACE_MS) {
    finished = true;
    console.log(
      `scan idle, last result: ${scan?.LastExecutionResult?.Status ?? "none"} at ${scan?.LastExecutionResult?.EndTimeUtc ?? "-"}`
    );
    break;
  }

  await sleep(POLL_MS);
}
/* oxlint-enable eslint/no-await-in-loop */

if (!finished) {
  console.log(`timeout after ${timeoutMin}m, scan still running; counts so far:`);
}

const c = await counts();

console.log(`\nitems: movies ${c.MovieCount}, series ${c.SeriesCount}, episodes ${c.EpisodeCount}`);

/* oxlint-disable eslint/no-await-in-loop -- sequential so the report prints in type order */
for (const type of ["Movie", "Series", "Episode"]) {
  const s = await imageStats(type);

  console.log(
    `${type.padEnd(8)} total ${s.total} | Primary ${s.primary} | Backdrop ${s.backdrop} | Logo ${s.logo}`
  );
}
/* oxlint-enable eslint/no-await-in-loop */

process.exit(finished ? 0 : 1);
