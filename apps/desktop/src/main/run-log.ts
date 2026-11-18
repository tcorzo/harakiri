import { closeSync, mkdirSync, openSync, readdirSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

import { getTextFormatter, type Sink } from "@logtape/logtape";

/** Each run's log is named for its start time, so a name sorts with its age. */
const runLogName = /^harakiri-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d+)?\.log$/;

/**
 * Opens this run's log file under `dir` and deletes all but the newest `keep` run logs. Writes are
 * synchronous, so a crash or a kill still leaves the lines leading up to it. The file is the
 * owner's only, though mpv's lines arrive with tokens already redacted.
 */
export function openRunLog(
  dir: string,
  startedAt: Date,
  keep = 10
): { readonly path: string; readonly sink: Sink & Disposable } {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = startedAt.toISOString().slice(0, 19).replaceAll(":", "-");
  const path = join(dir, `harakiri-${stamp}-${process.pid}.log`);
  const fd = openSync(path, "a", 0o600);

  const stale = readdirSync(dir)
    .filter((name) => runLogName.test(name))
    .toSorted()
    .toReversed()
    .slice(keep);

  for (const name of stale) rmSync(join(dir, name), { force: true });

  const format = getTextFormatter({ timestamp: "date-time-tz" });

  const sink = (record: Parameters<Sink>[0]): void => {
    writeSync(fd, format(record));
  };

  return { path, sink: Object.assign(sink, { [Symbol.dispose]: () => closeSync(fd) }) };
}
