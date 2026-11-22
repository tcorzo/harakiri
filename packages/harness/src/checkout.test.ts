import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { E2E_PORT_RANGE, checkoutIdOf, e2eServerFor, e2eServerOf, ownsLegacyE2e } from "./checkout";

/** "00" to "ff". */
const BYTES = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, "0"));

describe(ownsLegacyE2e, () => {
  it("removes the legacy container only when its /config is this checkout's state/config", () => {
    const state = "/srv/checkout-a/.cache/jellyfin-e2e";

    expect(ownsLegacyE2e("/srv/checkout-a/.cache/jellyfin-e2e/config", state)).toBe(true);
    expect(ownsLegacyE2e("/srv/checkout-a/.cache/jellyfin-e2e/config/", state)).toBe(true);
    expect(ownsLegacyE2e("/srv/checkout-b/.cache/jellyfin-e2e/config", state)).toBe(false);
    expect(ownsLegacyE2e("/srv/checkout-a/.cache/jellyfin-e2e", state)).toBe(false);
    expect(ownsLegacyE2e(undefined, state)).toBe(false);
  });

  it("compares real paths, so a symlinked checkout owns the container its target made", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "harakiri-legacy-"));

    try {
      mkdirSync(path.join(dir, "real/.cache/jellyfin-e2e/config"), { recursive: true });
      symlinkSync(path.join(dir, "real"), path.join(dir, "link"));

      expect(
        ownsLegacyE2e(
          path.join(dir, "real/.cache/jellyfin-e2e/config"),
          path.join(dir, "link/.cache/jellyfin-e2e")
        )
      ).toBe(true);
      expect(ownsLegacyE2e("", path.join(dir, "link/.cache/jellyfin-e2e"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe(checkoutIdOf, () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "harakiri-checkout-"));
    mkdirSync(path.join(dir, "one"));
    mkdirSync(path.join(dir, "two"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("is stable for a path, and the same through a symlink", () => {
    symlinkSync(path.join(dir, "one"), path.join(dir, "link"));
    expect(checkoutIdOf(path.join(dir, "one"))).toBe(checkoutIdOf(path.join(dir, "one")));
    expect(checkoutIdOf(path.join(dir, "link"))).toBe(checkoutIdOf(path.join(dir, "one")));
  });

  it("differs between checkouts", () => {
    expect(checkoutIdOf(path.join(dir, "one"))).not.toBe(checkoutIdOf(path.join(dir, "two")));
  });

  it("is the id guest.sh always named the guest with: sha256sum of the path, 8 hex digits", () => {
    const repo = path.join(dir, "one");
    const script = 'printf %s "$(cd "$1" && pwd -P)" | sha256sum | cut -c1-8';

    const shell = spawnSync("sh", ["-c", script, "sh", repo], { encoding: "utf-8" });

    expect(checkoutIdOf(repo)).toBe(shell.stdout.trim());
  });
});

describe(e2eServerOf, () => {
  it("derives the name, port and discovery address from the id", () => {
    expect(e2eServerOf("00000000")).toStrictEqual({
      name: "harakiri-jellyfin-e2e-00000000",
      port: 20_000,
      url: "http://127.0.0.1:20000",
      discoveryAddress: "127.1.0.1",
    });
    expect(e2eServerOf("ffffffff")).toStrictEqual({
      name: "harakiri-jellyfin-e2e-ffffffff",
      port: 27_295,
      url: "http://127.0.0.1:27295",
      discoveryAddress: "127.2.255.2",
    });
  });

  it("wraps the port and the address octets at their edges", () => {
    expect(e2eServerOf("0000270f").port).toBe(29_999);
    expect(e2eServerOf("00002710").port).toBe(20_000);
    expect(e2eServerOf("fdfffd00")).toMatchObject({
      port: 22_096,
      discoveryAddress: "127.254.255.254",
    });
    expect(e2eServerOf("fe00fe00")).toMatchObject({ port: 27_888, discoveryAddress: "127.1.0.1" });
  });

  it("stays in range, clear of 127.0.0.0/24, for every value of every byte", () => {
    // Each byte position takes every value from 00 to ff, with the other bytes all 00 or all ff.
    const ids = BYTES.flatMap((byte) =>
      [0, 1, 2, 3].flatMap((at) =>
        ["00", "ff"].map((rest) =>
          Array.from({ length: 4 }, (_unused, i) => (i === at ? byte : rest)).join("")
        )
      )
    );

    expect(ids).toHaveLength(2048);

    const outside = ids.filter((id) => {
      const { port, discoveryAddress } = e2eServerOf(id);
      const [first, second = 0, third = -1, fourth = 0] = discoveryAddress.split(".").map(Number);

      return (
        port < E2E_PORT_RANGE.first ||
        port >= E2E_PORT_RANGE.first + E2E_PORT_RANGE.size ||
        first !== 127 ||
        second < 1 ||
        second > 254 ||
        third < 0 ||
        third > 255 ||
        fourth < 1 ||
        fourth > 254
      );
    });

    expect(outside).toStrictEqual([]);
  });

  it("rejects an id that is not 8 hex digits", () => {
    expect(() => e2eServerOf("/workspace")).toThrow(
      "A checkout id is 8 lowercase hex digits, not '/workspace'"
    );
  });
});

describe(e2eServerFor, () => {
  const repo = import.meta.dirname;

  it("on the host, derives everything from the checkout's path, ignoring HARAKIRI_CHECKOUT_ID", () => {
    expect(e2eServerFor(repo, {}, false)).toStrictEqual(e2eServerOf(checkoutIdOf(repo)));
    expect(e2eServerFor(repo, { HARAKIRI_CHECKOUT_ID: "0000ffff" }, false)).toStrictEqual(
      e2eServerOf(checkoutIdOf(repo))
    );
  });

  it("takes the host checkout's id from HARAKIRI_CHECKOUT_ID, which guest.sh passes", () => {
    expect(e2eServerFor(repo, { HARAKIRI_CHECKOUT_ID: "0000ffff" }, true).name).toBe(
      "harakiri-jellyfin-e2e-0000ffff"
    );
  });

  it("in the guest without HARAKIRI_CHECKOUT_ID, throws naming guest.sh exec", () => {
    expect(() => e2eServerFor(repo, {}, true)).toThrow(
      "Run the command through dev/vm/guest.sh exec"
    );
  });

  it("lets HARAKIRI_E2E_PORT replace the derived port, and rejects a bad one", () => {
    const env = { HARAKIRI_CHECKOUT_ID: "00000000", HARAKIRI_E2E_PORT: "28123" };

    expect(e2eServerFor(repo, env, true)).toMatchObject({
      port: 28_123,
      url: "http://127.0.0.1:28123",
    });
    expect(() => e2eServerFor(repo, { ...env, HARAKIRI_E2E_PORT: "80" }, false)).toThrow(
      "HARAKIRI_E2E_PORT must be a port from 1024 to 65535, not '80'"
    );
  });
});
