// Follows the library scan until it finishes (or times out), then reports item and image counts.
// Run: mise exec -- bun dev/jellyfin/wait-scan.ts [timeoutMinutes=180]

import { api, login, waitForServer } from "./client.ts";

type Task = {
  Key: string;
  State: "Idle" | "Cancelling" | "Running";
  CurrentProgressPercentage?: number;
  LastExecutionResult?: { Status: string; EndTimeUtc: string };
};
type Item = { ImageTags?: Record<string, string>; BackdropImageTags?: string[] };
type Counts = { MovieCount: number; SeriesCount: number; EpisodeCount: number };

const timeoutMin = Number(process.argv[2] ?? 180);
const POLL_MS = 15_000;
const IDLE_GRACE_MS = 45_000; // the task may take a moment to enter Running after /Library/Refresh

await waitForServer();
let auth = await login();
const { userId } = auth;

// Another login with the same DeviceId revokes our token; log in again once and retry.
async function get<T>(path: string): Promise<T> {
  try {
    return await api<T>("GET", path, { token: auth.token });
  } catch (e) {
    if (!String(e).includes("-> 401")) throw e;
    auth = await login();
    return api<T>("GET", path, { token: auth.token });
  }
}

async function counts(): Promise<Counts> {
  return get<Counts>(`/Items/Counts?userId=${userId}`);
}

async function imageStats(type: string) {
  const q = new URLSearchParams({
    IncludeItemTypes: type,
    Recursive: "true",
    EnableImageTypes: "Primary,Backdrop,Logo",
    EnableUserData: "false",
    userId,
  });
  const r = await get<{ Items: Item[]; TotalRecordCount: number }>(`/Items?${q}`);
  return {
    total: r.TotalRecordCount,
    primary: r.Items.filter((i) => i.ImageTags?.Primary).length,
    backdrop: r.Items.filter((i) => (i.BackdropImageTags?.length ?? 0) > 0).length,
    logo: r.Items.filter((i) => i.ImageTags?.Logo).length,
  };
}

const start = Date.now();
const deadline = start + timeoutMin * 60_000;
let seenRunning = false;
let finished = false;
while (Date.now() < deadline) {
  const tasks = await get<Task[]>("/ScheduledTasks?isHidden=false");
  const scan = tasks.find((t) => t.Key === "RefreshLibrary");
  const c = await counts();
  const elapsed = Math.round((Date.now() - start) / 60_000);
  const pct = scan?.CurrentProgressPercentage?.toFixed(1) ?? "-";
  console.log(
    `[${new Date().toISOString()} +${elapsed}m] scan ${scan?.State ?? "?"} ${pct}% | movies ${c.MovieCount} series ${c.SeriesCount} episodes ${c.EpisodeCount}`
  );
  if (scan?.State === "Running") seenRunning = true;
  else if (seenRunning || Date.now() - start > IDLE_GRACE_MS) {
    finished = true;
    console.log(
      `scan idle, last result: ${scan?.LastExecutionResult?.Status ?? "none"} at ${scan?.LastExecutionResult?.EndTimeUtc ?? "-"}`
    );
    break;
  }
  await Bun.sleep(POLL_MS);
}
if (!finished) console.log(`timeout after ${timeoutMin}m, scan still running; counts so far:`);

const c = await counts();
console.log(`\nitems: movies ${c.MovieCount}, series ${c.SeriesCount}, episodes ${c.EpisodeCount}`);
for (const type of ["Movie", "Series", "Episode"]) {
  const s = await imageStats(type);
  console.log(
    `${type.padEnd(8)} total ${s.total} | Primary ${s.primary} | Backdrop ${s.backdrop} | Logo ${s.logo}`
  );
}
process.exit(finished ? 0 : 1);
