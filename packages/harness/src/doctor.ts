import { describeFailure, runTool, type ToolRun } from "./process";
import { compareVersions, formatVersion, parseVersion, type Version } from "./version";

export type Verdict =
  | { readonly status: "ok"; readonly detail: string }
  | { readonly status: "missing"; readonly detail: string }
  | { readonly status: "outdated"; readonly detail: string };

export interface Check {
  readonly label: string;
  /** A failed required check makes `doctor` exit non-zero; an optional one only warns. */
  readonly required: boolean;
  readonly probe: readonly [command: string, ...args: string[]];
  readonly judge: (run: ToolRun) => Verdict;
}

function output(run: ToolRun): string | null {
  return run.kind === "exited" && run.code === 0 ? `${run.stdout}\n${run.stderr}` : null;
}

function notRunnable(run: ToolRun): Verdict {
  return run.kind === "not-found"
    ? { status: "missing", detail: `${run.command} is not on PATH` }
    : { status: "missing", detail: describeFailure(run) };
}

export function versionAtLeast(prefix: RegExp, min: Version | null): Check["judge"] {
  return (run) => {
    const text = output(run);

    if (text === null) {
      return notRunnable(run);
    }
    const found = parseVersion(text, prefix);

    if (found === null) {
      return { status: "missing", detail: `no version matching ${prefix.source}` };
    }

    if (min !== null && compareVersions(found, min) < 0) {
      return { status: "outdated", detail: `${formatVersion(found)} < ${formatVersion(min)}` };
    }

    return { status: "ok", detail: formatVersion(found) };
  };
}

/** Every name must appear as a row of an `ffmpeg -filters/-encoders/-bsfs` listing. */
export function listsAll(names: readonly string[], row: (name: string) => RegExp): Check["judge"] {
  return (run) => {
    const text = output(run);

    if (text === null) {
      return notRunnable(run);
    }
    const absent = names.filter((name) => !row(name).test(text));

    return absent.length === 0
      ? { status: "ok", detail: names.join(", ") }
      : { status: "missing", detail: `missing ${absent.join(", ")}` };
  };
}

const ffmpegRow = (name: string) => new RegExp(`^\\s*\\S+\\s+${name}\\s`, "m");

export const CHECKS: readonly Check[] = [
  {
    label: "mpv",
    required: true,
    probe: ["mpv", "--version"],
    judge: versionAtLeast(/^mpv v?/m, [0, 41, 0]),
  },
  {
    label: "libplacebo (linked into mpv)",
    required: true,
    probe: ["mpv", "--version"],
    judge: versionAtLeast(/^libplacebo version: v?/m, null),
  },
  {
    label: "ffmpeg filter libplacebo",
    required: true,
    probe: ["ffmpeg", "-hide_banner", "-filters"],
    judge: listsAll(["libplacebo"], ffmpegRow),
  },
  {
    // FFmpeg ships dovi_rpu as a bitstream filter, not an AVFilter, so it is listed by -bsfs.
    label: "ffmpeg bitstream filter dovi_rpu",
    required: true,
    probe: ["ffmpeg", "-hide_banner", "-bsfs"],
    judge: listsAll(["dovi_rpu"], (name) => new RegExp(`^${name}$`, "m")),
  },
  {
    label: "ffmpeg encoders",
    required: true,
    probe: ["ffmpeg", "-hide_banner", "-encoders"],
    judge: listsAll(["ac3", "eac3", "dca", "truehd"], ffmpegRow),
  },
  {
    label: "kwin_wayland",
    required: true,
    probe: ["kwin_wayland", "--version"],
    judge: versionAtLeast(/kwin /, null),
  },
  {
    label: "weston",
    required: true,
    probe: ["weston", "--version"],
    judge: versionAtLeast(/weston /, [15, 0, 0]),
  },
  {
    label: "podman",
    required: false,
    probe: ["podman", "--version"],
    judge: versionAtLeast(/podman version /, null),
  },
  {
    label: "dovi_tool",
    required: true,
    probe: ["dovi_tool", "--version"],
    judge: versionAtLeast(/dovi_tool /, null),
  },
  {
    label: "hdr10plus_tool",
    required: true,
    probe: ["hdr10plus_tool", "--version"],
    judge: versionAtLeast(/hdr10plus_tool /, null),
  },
];

export interface CheckResult {
  readonly check: Check;
  readonly verdict: Verdict;
}

export function runChecks(checks: readonly Check[]): CheckResult[] {
  return checks.map((check) => {
    const [command, ...args] = check.probe;

    return { check, verdict: check.judge(runTool(command, args)) };
  });
}

export function requiredFailures(results: readonly CheckResult[]): CheckResult[] {
  return results.filter((r) => r.check.required && r.verdict.status !== "ok");
}
