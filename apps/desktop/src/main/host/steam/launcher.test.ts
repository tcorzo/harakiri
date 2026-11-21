import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { desktopEntry, launcherFiles, launcherScript, writeLauncher } from "./launcher";

const ARTWORK = path.resolve(import.meta.dirname, "../../../../build/steam");

const tempDir = async () => await mkdtemp(path.join(tmpdir(), "harakiri-launcher-"));

describe(launcherScript, () => {
  it("the script clears the preload and execs the AppImage in place", () => {
    expect(launcherScript("/opt/harakiri/harakiri-x86_64.AppImage")).toBe(
      [
        "#!/bin/sh",
        `# Written by harakiri's "Add to Steam"; harakiri rewrites it at each start.`,
        "# Steam's overlay preload crashes Chromium's GPU process (harakiri #10), so it goes before harakiri starts.",
        "unset LD_PRELOAD",
        "exec '/opt/harakiri/harakiri-x86_64.AppImage' \"$@\"",
        "",
      ].join("\n")
    );
  });

  it("a quote and a space in the AppImage path survive a real sh", async () => {
    const root = await tempDir();

    try {
      const dir = path.join(root, "my apps", "harakiri's");
      await mkdir(dir, { recursive: true });
      const fake = path.join(dir, "fake");
      await writeFile(
        fake,
        ["#!/bin/sh", `printf "%s|%s|%s" "$0" "$*" "$(env | grep -c '^LD_PRELOAD=')"`, ""].join(
          "\n"
        )
      );
      await chmod(fake, 0o755);
      const script = path.join(root, "harakiri.sh");
      await writeFile(script, launcherScript(fake));

      const stdout = execFileSync("/bin/sh", [script, "a b"], {
        env: { ...process.env, LD_PRELOAD: "/nonexistent/overlay.so" },
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });

      expect(stdout).toBe(`${fake}|a b|0`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("escapes a single quote as '\\''", () => {
    expect(launcherScript("/opt/my apps/harakiri's/x")).toContain(
      "exec '/opt/my apps/harakiri'\\''s/x' \"$@\"\n"
    );
  });
});

describe(desktopEntry, () => {
  it("the .desktop entry, bare paths", () => {
    expect(desktopEntry(launcherFiles("/data/harakiri"))).toBe(
      [
        "[Desktop Entry]",
        "Type=Application",
        "Name=harakiri",
        "Comment=TV-first Jellyfin player",
        "Exec=/data/harakiri/steam/harakiri.sh",
        "Path=/data/harakiri/steam",
        "Icon=/data/harakiri/steam/icon.png",
        "Terminal=false",
        "NoDisplay=true",
        "",
      ].join("\n")
    );
  });

  it("Exec quotes a path with a space", () => {
    expect(desktopEntry(launcherFiles("/data/my harakiri"))).toContain(
      'Exec="/data/my harakiri/steam/harakiri.sh"\n'
    );
  });

  it("Exec escapes a dollar and a backslash, then doubles backslashes", () => {
    const entry = desktopEntry(launcherFiles("/data/a'b$c\\d"));
    expect(entry).toContain('Exec="/data/a\'b\\\\$c\\\\\\\\d/steam/harakiri.sh"\n');
    expect(entry).toContain("Path=/data/a'b$c\\\\d/steam\n");
  });

  it("throws on a path with a newline", () => {
    expect(() => desktopEntry(launcherFiles("/data/a\nb"))).toThrow(/newline/u);
  });
});

describe(writeLauncher, () => {
  it("writes 0755 and 0644, then reports no change on a second run", async () => {
    const root = await tempDir();

    try {
      const files = launcherFiles(root);
      const target = "/opt/harakiri/harakiri-x86_64.AppImage";
      await expect(writeLauncher(files, target, ARTWORK)).resolves.toBe(true);

      const { mode: scriptMode } = await stat(files.script);
      const { mode: desktopMode } = await stat(files.desktop);

      expect(scriptMode % 0o1000).toBe(0o755);
      expect(desktopMode % 0o1000).toBe(0o644);
      await expect(readFile(files.icon)).resolves.toStrictEqual(
        await readFile(path.join(ARTWORK, "icon.png"))
      );
      await expect(writeLauncher(files, target, ARTWORK)).resolves.toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rewrites the script when the AppImage moved", async () => {
    const root = await tempDir();

    try {
      const files = launcherFiles(root);
      await writeLauncher(files, "/opt/a/harakiri.AppImage", ARTWORK);
      await expect(writeLauncher(files, "/opt/b/harakiri.AppImage", ARTWORK)).resolves.toBe(true);
      await expect(readFile(files.script, "utf-8")).resolves.toContain(
        "exec '/opt/b/harakiri.AppImage'"
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
