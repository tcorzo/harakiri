import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface LauncherFiles {
  /** `<userData>/steam` */
  readonly dir: string;
  readonly script: string;
  readonly desktop: string;
  readonly icon: string;
}

export const launcherFiles = (userData: string): LauncherFiles => {
  const dir = path.join(userData, "steam");

  return {
    dir,
    script: path.join(dir, "harakiri.sh"),
    desktop: path.join(dir, "harakiri.desktop"),
    icon: path.join(dir, "icon.png"),
  };
};

const shQuote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;

export const launcherScript = (target: string): string =>
  [
    "#!/bin/sh",
    `# Written by harakiri's "Add to Steam"; harakiri rewrites it at each start.`,
    "# Steam's overlay preload crashes Chromium's GPU process (harakiri #10), so it goes before harakiri starts.",
    "unset LD_PRELOAD",
    `exec ${shQuote(target)} "$@"`,
    "",
  ].join("\n");

/** The Desktop Entry string-value escape. */
const stringValue = (value: string): string => value.replaceAll("\\", "\\\\");

// No `%`: in Exec it starts a field code, so a path with one is quoted and written as `%%`.
const BARE_EXEC = /^[\w./+,=@-]+$/u;

const execArgument = (value: string): string =>
  BARE_EXEC.test(value)
    ? value
    : stringValue(`"${value.replaceAll("%", "%%").replaceAll(/[`"$\\]/gu, String.raw`\$&`)}"`);

export const desktopEntry = (files: LauncherFiles): string => {
  for (const value of [files.script, files.dir, files.icon]) {
    if (/[\n\r]/u.test(value)) {
      throw new Error("A .desktop entry cannot hold a path with a newline.");
    }
  }

  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=harakiri",
    "Comment=TV-first Jellyfin player",
    `Exec=${execArgument(files.script)}`,
    `Path=${stringValue(files.dir)}`,
    `Icon=${stringValue(files.icon)}`,
    "Terminal=false",
    "NoDisplay=true",
    "",
  ].join("\n");
};

const readOrNull = async (file: string): Promise<Buffer | null> => {
  try {
    return await readFile(file);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
};

/** Temp file, then rename; skipped when the bytes already match. */
const writeAtomic = async (file: string, bytes: Buffer, mode: number): Promise<boolean> => {
  const current = await readOrNull(file);

  if (current?.equals(bytes) === true) {
    return false;
  }

  const temp = `${file}.${process.pid}.tmp`;

  try {
    await writeFile(temp, bytes, { mode });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });

    throw error;
  }

  return true;
};

/**
 * Writes the script (0755), the .desktop (0644) and the icon (copied from `<artwork>/icon.png`),
 * each atomically and only when its bytes differ. Returns whether any changed.
 */
export const writeLauncher = async (
  files: LauncherFiles,
  target: string,
  artwork: string
): Promise<boolean> => {
  await mkdir(files.dir, { recursive: true });

  const icon = await readFile(path.join(artwork, "icon.png"));

  const results = await Promise.all([
    writeAtomic(files.script, Buffer.from(launcherScript(target)), 0o755),
    writeAtomic(files.desktop, Buffer.from(desktopEntry(files)), 0o644),
    writeAtomic(files.icon, icon, 0o644),
  ]);

  return results.some(Boolean);
};
