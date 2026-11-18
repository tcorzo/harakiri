import { setTimeout as sleep } from "node:timers/promises";

import { joinFacts } from "@harakiri/jellyfin";

import {
  expect,
  play,
  playerEvents,
  playerEventUntil,
  probe,
  probeUntil,
  recordPlayerEvents,
  stop,
  test,
  until,
} from "./support/harakiri";
import { ITEMS, TICKS_PER_SECOND, type PickedItem } from "./support/jellyfin";
import { mpvProcesses, pressKey } from "./support/mpv";

// mpv decodes for real but shows and plays nothing: fast and deterministic. The default for the fixture.
test.use({ mpvArgs: "--vo=null --ao=null" });

const ticks = (seconds: number) => seconds * TICKS_PER_SECOND;

const request = (item: PickedItem, startSeconds: number) => ({
  itemId: item.id,
  mediaSourceId: item.mediaSourceId,
  startPositionTicks: ticks(startSeconds),
});

test.beforeEach(({ signIn }) => signIn());

test("plays from a start position over a direct Jellyfin stream and reports it", async ({
  launch,
  jellyfin,
  account,
  preserveUserData,
  backend,
}) => {
  const item = await jellyfin.pickItem(ITEMS.sdrH264Short);
  await preserveUserData(item.id);
  const { page } = await launch();
  await recordPlayerEvents(page);

  await play(page, request(item, 120));

  const first = await probeUntil(page, (p) => p.running && (p.timePos ?? 0) >= 120);
  expect(first.path).toBe(
    new URL(
      `Videos/${item.id}/stream?static=true&MediaSourceId=${item.mediaSourceId}`,
      backend.server
    ).href
  );
  expect(first.path).not.toContain(account.accessToken);
  expect(first.pause).toBe(false);
  const startedAt = first.timePos ?? 0;
  await probeUntil(page, (p) => (p.timePos ?? 0) >= startedAt + 2);

  const playing = await playerEventUntil(page, (event) => event.phase === "playing");
  expect(playing.itemId).toBe(item.id);
  expect(playing.positionTicks).toBeGreaterThanOrEqual(ticks(120));
  expect(joinFacts(playing.facts)).toMatch(/\S/);
  expect(playing.transcodeReasons).toEqual([]);
  const phases = (await playerEvents(page)).map((event) => event.phase);
  expect(phases.indexOf("starting")).toBeLessThan(phases.indexOf("playing"));

  const server = await until(
    "Jellyfin sees the item playing for this device",
    () => jellyfin.nowPlaying(),
    (session) => session?.NowPlayingItem?.Id === item.id
  );

  expect(server?.PlayState?.PlayMethod).toBe("DirectPlay");
});

test("mpv's own key bindings pause, seek, resume and stop through the app", async ({
  launch,
  jellyfin,
  userDataDir,
  preserveUserData,
}) => {
  const item = await jellyfin.pickItem(ITEMS.sdrH264Short);
  await preserveUserData(item.id);
  const { page } = await launch();
  await recordPlayerEvents(page);
  await play(page, request(item, 60));
  await probeUntil(page, (p) => (p.timePos ?? 0) >= 61);

  await pressKey(userDataDir, "SPACE");
  const paused = await probeUntil(page, (p) => p.pause === true);
  expect(paused.osdVisible).toBe(true);
  await playerEventUntil(page, (event) => event.phase === "paused");
  await until(
    "Jellyfin sees the pause",
    () => jellyfin.nowPlaying(),
    (session) => session?.PlayState?.IsPaused === true
  );
  const frozenAt = paused.timePos ?? 0;
  await sleep(1000);
  expect((await probe(page)).timePos).toBeCloseTo(frozenAt, 1);

  await pressKey(userDataDir, "RIGHT");
  const seeked = await probeUntil(page, (p) => (p.timePos ?? 0) >= frozenAt + 25);
  expect(seeked.timePos).toBeCloseTo(frozenAt + 30, 0);
  expect(seeked.pause).toBe(true);

  await pressKey(userDataDir, "SPACE");
  const resumed = await probeUntil(page, (p) => p.pause === false);
  await probeUntil(page, (p) => (p.timePos ?? 0) >= (resumed.timePos ?? 0) + 1.5);
  await until(
    "a playing event after the pause",
    () => playerEvents(page),
    (events) =>
      events.findLastIndex((e) => e.phase === "playing") >
      events.findIndex((e) => e.phase === "paused")
  );

  await pressKey(userDataDir, "ESC");
  const stopped = await playerEventUntil(page, (event) => event.phase === "stopped");
  expect(stopped.itemId).toBe(item.id);
  expect((await probe(page)).running).toBe(false);
  expect(mpvProcesses(userDataDir)).toEqual([]);
});

test("stopping saves the resume position on the server", async ({
  launch,
  jellyfin,
  preserveUserData,
}) => {
  const item = await jellyfin.pickItem(ITEMS.sdrH264Short);
  expect(item.runTimeTicks).toBeGreaterThan(ticks(300));
  await preserveUserData(item.id);
  const { page } = await launch();
  await recordPlayerEvents(page);
  await play(page, request(item, 200));
  await probeUntil(page, (p) => (p.timePos ?? 0) >= 203);

  await stop(page);

  const stopped = await playerEventUntil(page, (event) => event.phase === "stopped");
  expect((await probe(page)).running).toBe(false);
  expect(stopped.positionTicks).toBeGreaterThanOrEqual(ticks(203));

  const saved = await until(
    "Jellyfin stores the resume point",
    () => jellyfin.userData(item.id),
    (data) => data.PlaybackPositionTicks > 0,
    5000
  );

  expect(Math.abs(saved.PlaybackPositionTicks - stopped.positionTicks)).toBeLessThanOrEqual(
    ticks(3)
  );
  expect(saved.Played).toBe(false);
  await until(
    "Jellyfin clears now playing",
    () => jellyfin.nowPlaying(),
    (s) => s === undefined,
    5000
  );
});

test("a second play replaces the first: one mpv, and the first reports stopped", async ({
  launch,
  jellyfin,
  userDataDir,
  preserveUserData,
}) => {
  const [first, second] = await jellyfin.pickItems(ITEMS.sdrH264Short, 2);

  if (!first || !second) {
    throw new Error("pickItems returned fewer items than asked");
  }
  await preserveUserData(first.id);
  await preserveUserData(second.id);
  const { page } = await launch();
  await recordPlayerEvents(page);

  // Fired together, as a double press would: main must serialize them.
  await page.evaluate(
    ([a, b]) => Promise.all([window.harakiri.player.play(a), window.harakiri.player.play(b)]),
    [request(first, 60), request(second, 60)] as const
  );

  const now = await probeUntil(page, (p) => p.running && (p.timePos ?? 0) >= 61);
  expect(now.path).toContain(`/Videos/${second.id}/stream`);
  expect(mpvProcesses(userDataDir)).toHaveLength(1);

  const stoppedFirst = await playerEventUntil(
    page,
    (event) => event.phase === "stopped" && event.itemId === first.id
  );

  expect(stoppedFirst.positionTicks).toBeGreaterThanOrEqual(ticks(60));
  const events = await playerEvents(page);
  expect(events.some((e) => e.itemId === second.id && e.phase === "stopped")).toBe(false);
});

test("quitting the app mid-playback stops mpv and reports the stop", async ({
  launch,
  jellyfin,
  userDataDir,
  preserveUserData,
}) => {
  const item = await jellyfin.pickItem(ITEMS.sdrH264Short);
  await preserveUserData(item.id);
  const { app, page } = await launch();
  await play(page, request(item, 150));
  await probeUntil(page, (p) => (p.timePos ?? 0) >= 152);
  expect(mpvProcesses(userDataDir)).toHaveLength(1);

  await app.close();

  expect(mpvProcesses(userDataDir)).toEqual([]);
  await until(
    "Jellyfin clears now playing",
    () => jellyfin.nowPlaying(),
    (s) => s === undefined,
    5000
  );
  const saved = await jellyfin.userData(item.id);
  expect(saved.PlaybackPositionTicks).toBeGreaterThanOrEqual(ticks(152));
  expect(saved.PlaybackPositionTicks).toBeLessThan(ticks(170));
});
