import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import type { Backend } from "./support/backend";
import { padDpad, plugPad, tap } from "./support/gamepad";
import { cardName, expect, expectFocus, test } from "./support/harakiri";
import { publicInfo } from "./support/jellyfin";
import type { Jellyfin } from "./support/jellyfin";
import { arrowKeys, focusField, keysFor, typeOnScreen } from "./support/keyboard";
import { deadAddress, reply, stubServer } from "./support/stub";
import type { Stub } from "./support/stub";

const main = (page: Page, name: string) => page.getByRole("main", { name, exact: true });

/** Lands on the library: Play focused on tonight's film, and Recently Added opening on the server's newest title. */
async function expectLibrary(page: Page, jellyfin: Jellyfin): Promise<void> {
  await expect(main(page, "Library")).toBeVisible({ timeout: 20_000 });
  const focus = await expectFocus(page, /^(Play|Resume) \S/, 10_000);
  expect(focus.route).toBe("/library");
  const [newest] = await jellyfin.latest();

  if (newest === undefined) {
    throw new Error("The library has nothing recently added");
  }
  await expect(
    page.getByRole("region", { name: "Recently Added", exact: true }).getByRole("button").first()
  ).toHaveAccessibleName(cardName(newest.Name));
}

/** The session main stored for this profile, which must be the one the server just issued. */
async function expectStoredSession(
  page: Page,
  backend: Backend,
  userDataDir: string,
  userId: string
) {
  const info = await publicInfo(backend.server);
  const session = await page.evaluate(async () => window.harakiri.session.get());
  expect(session).toMatchObject({
    serverUrl: backend.server,
    serverId: info.id,
    serverName: info.name,
    serverVersion: info.version,
    userId,
    userName: backend.user,
    deviceId: readFileSync(join(userDataDir, "device-id"), "utf-8").trim(),
  });
}

/** From the sign-in chooser: Another user, then the user name and password on the on-screen keyboard. */
async function signInOnScreen(
  page: Page,
  { user, password }: { readonly user: string; readonly password: string }
): Promise<void> {
  const keys = arrowKeys(page);
  await expectFocus(page, "Another user");
  await page.keyboard.press("Enter");
  await expect(main(page, "Your user name")).toBeVisible();
  await expectFocus(page, "q");
  await typeOnScreen(page, keys, keysFor(user));
  await expect(page.getByRole("textbox", { name: "User name" })).toHaveValue(user);
  await typeOnScreen(page, keys, ["Next"]);
  await expect(main(page, `Password for ${user}`)).toBeVisible();
  await expectFocus(page, "q");
  await typeOnScreen(page, keys, keysFor(password));
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(password);
  await typeOnScreen(page, keys, ["Sign in"]);
}

/** Begin, then the server address on the on-screen keyboard with the arrow keys, then Connect. */
async function submitAddress(page: Page, address: string): Promise<void> {
  await expectFocus(page, "Begin");
  await page.keyboard.press("Enter");
  await expect(main(page, "Find your server")).toBeVisible();
  await expectFocus(page, "q");
  await typeOnScreen(page, arrowKeys(page), keysFor(address, [":8096"]));
  await expect(page.getByRole("textbox", { name: "Server address" })).toHaveValue(address);
  await typeOnScreen(page, arrowKeys(page), ["Connect"]);
}

const jellyfinInfo = (version: string, name: string) =>
  reply.json(200, {
    LocalAddress: "http://127.0.0.1",
    ServerName: name,
    Version: version,
    ProductName: "Jellyfin Server",
    OperatingSystem: "",
    Id: "0123456789abcdef0123456789abcdef",
    StartupWizardCompleted: true,
  });

interface AddressCase {
  readonly name: string;
  readonly stub?: Readonly<Record<string, ReturnType<typeof reply.json>>>;
  readonly address?: () => Promise<string>;
  readonly message: (address: string) => string;
}

test.describe("with the server answering discovery on loopback", () => {
  // A unicast probe to the server's own loopback address keeps LAN servers out of the run (and
  // broadcast never reaches a rootless container).
  test.use({
    extraEnv: async ({ backend }, use) => {
      await use({ HARAKIRI_DISCOVERY_ADDRESS: backend.discoveryAddress });
    },
  });

  test("a fresh profile reaches the library with only a gamepad, in under a minute", async ({
    launch,
    jellyfin,
    account,
    userDataDir,
    backend,
  }) => {
    // Room past the minute, so the timing assertion below is what fails a slow run, not the timeout.
    test.setTimeout(120_000);
    const info = await publicInfo(backend.server);
    const { page } = await launch();
    const started = Date.now();
    await plugPad(page);
    const pad = padDpad(page);

    await expect(main(page, "Welcome")).toBeVisible();
    expect((await expectFocus(page, "Begin")).route).toBe("/onboarding");
    await tap(page, "a");

    // The server found by discovery takes focus, named and addressed as it answered.
    await expect(main(page, "Find your server")).toBeVisible();
    await expectFocus(page, `${info.name}, ${backend.server}`);
    await tap(page, "a");

    // The dev server lists no public users, so the chooser offers Another user and Quick Connect.
    await expect(main(page, `Sign in to ${info.name}`)).toBeVisible();
    await expect(page.getByText(`${info.name} · Jellyfin ${info.version}`)).toBeVisible();
    await expectFocus(page, "Another user");
    await expect(page.getByRole("button", { name: "Quick Connect" })).toBeVisible();
    await tap(page, "a");

    await expect(main(page, "Your user name")).toBeVisible();
    await expectFocus(page, "q");
    await typeOnScreen(page, pad, keysFor(backend.user));
    await expect(page.getByRole("textbox", { name: "User name" })).toHaveValue(backend.user);
    await typeOnScreen(page, pad, ["Next"]);

    await expect(main(page, `Password for ${backend.user}`)).toBeVisible();
    await typeOnScreen(page, pad, keysFor(backend.password));
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue(backend.password);
    await typeOnScreen(page, pad, ["Sign in"]);

    await expectLibrary(page, jellyfin);
    expect(Date.now() - started).toBeLessThan(60_000);
    await expectStoredSession(page, backend, userDataDir, account.userId);
  });

  test("the server's public users are a shortcut to the password step", async ({
    launch,
    jellyfin,
    account,
    userDataDir,
    backend,
  }) => {
    const { page } = await launch();
    // The server hides its one user, so its public list is served here; sign-in itself is real.
    await page.route("**/Users/Public", async (route) =>
      route.fulfill({ json: [{ Name: backend.user, Id: account.userId, HasPassword: true }] })
    );
    await expectFocus(page, "Begin");
    await page.keyboard.press("Enter");
    await expectFocus(page, `${(await publicInfo(backend.server)).name}, ${backend.server}`);
    await page.keyboard.press("Enter");

    await expect(main(page, "Who is watching")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Who is watching?" })).toBeVisible();
    await expectFocus(page, backend.user);
    await expect(page.getByRole("button", { name: backend.user, exact: true })).toContainText(
      "Password"
    );
    await page.keyboard.press("Enter");

    await expect(main(page, `Password for ${backend.user}`)).toBeVisible();
    await expectFocus(page, "q");
    await typeOnScreen(page, arrowKeys(page), [...keysFor(backend.password), "Sign in"]);

    await expectLibrary(page, jellyfin);
    await expectStoredSession(page, backend, userDataDir, account.userId);
  });

  test("Quick Connect signs in once a signed-in device approves the code", async ({
    launch,
    jellyfin,
    account,
    userDataDir,
    backend,
  }) => {
    const { page } = await launch();
    await expectFocus(page, "Begin");
    await page.keyboard.press("Enter");
    await expectFocus(page, `${(await publicInfo(backend.server)).name}, ${backend.server}`);
    await page.keyboard.press("Enter");
    await expectFocus(page, "Another user");
    await page.keyboard.press("ArrowDown");
    await expectFocus(page, "Quick Connect");
    await page.keyboard.press("Enter");

    await expect(main(page, "Quick Connect")).toBeVisible();
    await expectFocus(page, "Use a password instead");
    const shown = page.getByLabel(/^Code \d( \d)+$/);
    await expect(shown).toBeVisible();
    const code = (await shown.innerText()).trim();
    expect(code).toMatch(/^\d{6}$/);
    expect(await shown.getAttribute("aria-label")).toBe(`Code ${code.split("").join(" ")}`);

    await jellyfin.authorizeQuickConnect(code);

    await expectLibrary(page, jellyfin);
    await expectStoredSession(page, backend, userDataDir, account.userId);
  });

  test("a wrong password says so, clears the field, and the right one still signs in", async ({
    launch,
    jellyfin,
    account,
    userDataDir,
    backend,
  }) => {
    const { page } = await launch();
    await expectFocus(page, "Begin");
    await page.keyboard.press("Enter");
    await expectFocus(page, `${(await publicInfo(backend.server)).name}, ${backend.server}`);
    await page.keyboard.press("Enter");

    await signInOnScreen(page, { user: backend.user, password: "not-the-password" });

    await expect(page.getByRole("alert")).toHaveText(
      `That password did not work for ${backend.user}. Try again, or press Back to choose another user.`
    );
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
    // The keyboard stays where the owner left it, on Sign in, ready for a second try.
    expect((await expectFocus(page, "Sign in")).route).toBe("/onboarding");

    // One success resets the server's failed-attempt count, so reruns never lock the account.
    await typeOnScreen(page, arrowKeys(page), [...keysFor(backend.password), "Sign in"]);
    await expectLibrary(page, jellyfin);
    await expectStoredSession(page, backend, userDataDir, account.userId);
  });

  test("a server found after the owner starts typing does not take focus from the keyboard", async ({
    launch,
    backend,
  }) => {
    const { page } = await launch();
    await expectFocus(page, "Begin");
    await page.keyboard.press("Enter");
    await expectFocus(page, "q");
    // Discovery waits its full 1.5 s window; the owner moves on the keyboard before it ends.
    await page.keyboard.press("ArrowRight");
    await expectFocus(page, "w");
    await expect(
      page.getByRole("button", {
        name: `${(await publicInfo(backend.server)).name}, ${backend.server}`,
      })
    ).toBeVisible();
    await page.waitForTimeout(500);
    await expectFocus(page, "w");
  });

  test("Left from the on-screen keyboard reaches the server discovery found", async ({
    launch,
    backend,
  }) => {
    const { page } = await launch();
    const found = `${(await publicInfo(backend.server)).name}, ${backend.server}`;
    await expectFocus(page, "Begin");
    await page.keyboard.press("Enter");
    await expectFocus(page, found);
    // Right from the list meets the address field, the nearest control; Down enters the keyboard.
    await page.keyboard.press("ArrowRight");
    await expectFocus(page, "Server address");
    await page.keyboard.press("ArrowDown");
    await expectFocus(page, /^[0-9a-z]$/);
    await page.keyboard.press("ArrowLeft");
    await expectFocus(page, found);
  });

  test("Sign out returns to this server's sign-in, and the new session survives a relaunch", async ({
    launch,
    jellyfin,
    account,
    userDataDir,
    backend,
  }) => {
    const info = await publicInfo(backend.server);
    const first = await launch();
    let page = first.page;
    await expectFocus(page, "Begin");
    await page.keyboard.press("Enter");
    await expectFocus(page, `${info.name}, ${backend.server}`);
    await page.keyboard.press("Enter");
    await signInOnScreen(page, backend);
    await expectLibrary(page, jellyfin);

    await page.keyboard.press("ArrowUp");
    await expectFocus(page, "Settings");
    await page.keyboard.press("Enter");
    await expect(main(page, "Settings")).toBeVisible();
    await expectFocus(page, "Sign out");
    const facts = page.getByRole("main", { name: "Settings" }).locator("dl");
    await expect(facts).toContainText(`Signed in as${backend.user}`);
    await expect(facts).toContainText(`Server${info.name} · Jellyfin ${info.version}`);
    await expect(facts).toContainText(`Address${backend.server}`);
    // Unpackaged e2e has no APPIMAGE: updates are unsupported, so only the version shows.
    await expect(facts).toContainText(/AppVersion \d+\.\d+\.\d+$/);
    await expect(page.getByRole("button", { name: /Restart to update/ })).toHaveCount(0);
    const signedOut = await page.evaluate(async () => window.harakiri.session.get());

    const asSignedOut = async () =>
      fetch(new URL("Users/Me", backend.server), {
        headers: { Authorization: `MediaBrowser Token="${signedOut?.accessToken ?? ""}"` },
      });

    // The control: the very same request succeeds while the session is live.
    expect((await asSignedOut()).status).toBe(200);
    await page.keyboard.press("Enter");

    // Back on the same server's chooser, with the stored session gone.
    await expect(main(page, `Sign in to ${info.name}`)).toBeVisible();
    expect((await expectFocus(page, "Another user")).route).toBe("/onboarding");
    expect(await page.evaluate(async () => window.harakiri.session.get())).toBeNull();
    // The server revoked the old token too, so a copy of it signs nobody in.
    expect((await asSignedOut()).status).toBe(401);

    await signInOnScreen(page, backend);
    await expectLibrary(page, jellyfin);
    await expectStoredSession(page, backend, userDataDir, account.userId);

    await first.app.close();
    page = (await launch()).page;
    await expect(main(page, "Library")).toBeVisible({ timeout: 20_000 });
    expect((await expectFocus(page, /^(Play|Resume) \S/, 10_000)).route).toBe("/library");
    await expect(main(page, "Welcome")).toHaveCount(0);
    await expectStoredSession(page, backend, userDataDir, account.userId);
  });
});

test.describe("with no server answering discovery", () => {
  // 127.0.0.2 is loopback with nothing on UDP 7359: discovery finishes empty, deterministically.
  test.use({ extraEnv: { HARAKIRI_DISCOVERY_ADDRESS: "127.0.0.2" } });

  test("the on-screen keyboard types the address with the arrow keys", async ({
    launch,
    jellyfin,
    account,
    userDataDir,
    backend,
  }) => {
    const info = await publicInfo(backend.server);
    const { page } = await launch();
    await expectFocus(page, "Begin");
    await page.keyboard.press("Enter");

    await expect(main(page, "Find your server")).toBeVisible();
    await expect(
      page.getByText("No server answered. Type its address instead, or search again.")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Search again" })).toBeVisible();
    await expectFocus(page, "q");

    await typeOnScreen(page, arrowKeys(page), keysFor(backend.address, [":8096"]));
    await expect(page.getByRole("textbox", { name: "Server address" })).toHaveValue(
      backend.address
    );
    await typeOnScreen(page, arrowKeys(page), ["Connect"]);

    await expect(main(page, `Sign in to ${info.name}`)).toBeVisible();
    await expect(page.getByText(`${info.name} · Jellyfin ${info.version}`)).toBeVisible();
    await signInOnScreen(page, backend);
    await expectLibrary(page, jellyfin);
    await expectStoredSession(page, backend, userDataDir, account.userId);
  });

  test("Change server starts over from the welcome and reaches the library on a typed address", async ({
    launch,
    jellyfin,
    account,
    userDataDir,
    backend,
  }) => {
    const { page } = await launch();
    await submitAddress(page, backend.address);
    await signInOnScreen(page, backend);
    await expectLibrary(page, jellyfin);

    await page.keyboard.press("ArrowUp");
    await expectFocus(page, "Settings");
    await page.keyboard.press("Enter");
    await expectFocus(page, "Sign out");
    await page.keyboard.press("ArrowDown");
    await expectFocus(page, "Change server");
    await page.keyboard.press("Enter");

    await expect(main(page, "Welcome")).toBeVisible();
    expect((await expectFocus(page, "Begin")).route).toBe("/onboarding");
    expect(await page.evaluate(async () => window.harakiri.session.get())).toBeNull();

    await submitAddress(page, backend.address);
    await signInOnScreen(page, backend);
    await expectLibrary(page, jellyfin);
    await expectStoredSession(page, backend, userDataDir, account.userId);
  });

  test("a physical keyboard reaches the fields and types the address, user name and password", async ({
    launch,
    jellyfin,
    account,
    userDataDir,
    backend,
  }) => {
    // Up from the keyboard reaches each field, and the Enter that submits the user name must not
    // also press the password step's first key (it once typed a stray "q").
    const info = await publicInfo(backend.server);
    const { page } = await launch();
    await expectFocus(page, "Begin");
    await page.keyboard.press("Enter");
    await expectFocus(page, "q");
    await focusField(page, "Server address");
    await page.keyboard.type(backend.address);
    await page.keyboard.press("Enter");
    await expect(main(page, `Sign in to ${info.name}`)).toBeVisible();
    await expectFocus(page, "Another user");
    await page.keyboard.press("Enter");
    await expectFocus(page, "q");
    await focusField(page, "User name");
    await page.keyboard.type(backend.user);
    await page.keyboard.press("Enter");
    await expect(main(page, `Password for ${backend.user}`)).toBeVisible();
    await expectFocus(page, "q");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
    await focusField(page, "Password");
    await page.keyboard.type(backend.password);
    await page.keyboard.press("Enter");
    await expectLibrary(page, jellyfin);
    await expectStoredSession(page, backend, userDataDir, account.userId);
  });

  test("Left from the on-screen keyboard reaches Search again", async ({ launch }) => {
    const { page } = await launch();
    await expectFocus(page, "Begin");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Search again" })).toBeVisible();
    await expectFocus(page, "q");
    await page.keyboard.press("ArrowLeft");
    await expectFocus(page, "Search again");
  });

  const addressCases: readonly AddressCase[] = [
    {
      name: "an address that cannot be a server",
      address: async () => "ftp://nas",
      message: () =>
        "That is not an address harakiri can use. Type a host name or IP, such as 192.168.1.20 or jellyfin.local.",
    },
    {
      name: "an unreachable address",
      address: deadAddress,
      message: (address) =>
        `Nothing answered at ${address}. Check the address, and that the server is on and on this network.`,
    },
    {
      name: "a web server that answers 404",
      stub: {},
      message: (address) => `Something answered at ${address}, but it is not a Jellyfin server.`,
    },
    {
      name: "a web server that answers every path with a page",
      stub: {
        "/System/Info/Public": {
          status: 200,
          body: "<!doctype html><title>Router</title><h1>Log in to your router</h1>",
          type: "text/html",
        },
      },
      message: (address) => `Something answered at ${address}, but it is not a Jellyfin server.`,
    },
    {
      name: "another media server's JSON",
      stub: {
        "/System/Info/Public": reply.json(200, {
          ServerName: "nas",
          Version: "4.8.10.0",
          Id: "emby",
        }),
      },
      message: (address) => `Something answered at ${address}, but it is not a Jellyfin server.`,
    },
    {
      name: "a Jellyfin below 10.10",
      stub: { "/System/Info/Public": jellyfinInfo("10.9.11", "Old Jellyfin") },
      message: () =>
        "This server runs Jellyfin 10.9.11. harakiri needs 10.10 or newer. Update the server, then try again.",
    },
  ];

  for (const c of addressCases) {
    test(`${c.name} gets a plain message, and Back leads out`, async ({ launch }) => {
      const stub: Stub | undefined = c.stub === undefined ? undefined : await stubServer(c.stub);

      try {
        const address = stub?.address ?? (await c.address?.()) ?? "";
        const { page } = await launch();
        await submitAddress(page, address);

        await expect(page.getByRole("alert")).toHaveText(c.message(address));
        await expect(main(page, "Find your server")).toBeVisible();

        if (stub !== undefined) {
          expect(stub.seen).toContain("GET /System/Info/Public");
        }
        // Focus stays on the keyboard, so the owner can correct the address at once.
        expect((await expectFocus(page, "Connect")).route).toBe("/onboarding");

        await page.keyboard.press("Escape");
        await expect(main(page, "Welcome")).toBeVisible();
        await expectFocus(page, "Begin");
      } finally {
        await stub?.close();
      }
    });
  }

  test("a server that refuses the sign-in says so, and Back leads out step by step", async ({
    launch,
  }) => {
    const stub = await stubServer({
      "/System/Info/Public": jellyfinInfo("10.11.6", "Stub Jellyfin"),
      "/Users/Public": reply.json(200, []),
      "/QuickConnect/Enabled": reply.json(200, false),
      "/Users/AuthenticateByName": { status: 403, body: "" },
    });

    try {
      const { page } = await launch();
      await submitAddress(page, stub.address);

      await expect(main(page, "Sign in to Stub Jellyfin")).toBeVisible();
      await expect(page.getByText("Stub Jellyfin · Jellyfin 10.11.6")).toBeVisible();
      await expect(page.getByRole("button", { name: "Quick Connect" })).toHaveCount(0);
      await signInOnScreen(page, { user: "harakiri", password: "anything" });

      await expect(page.getByRole("alert")).toHaveText(
        "The server refused this sign-in. The account may be disabled; ask whoever runs the server."
      );
      expect(stub.seen).toContain("POST /Users/AuthenticateByName");
      expect(await page.evaluate(async () => window.harakiri.session.get())).toBeNull();

      await expectFocus(page, "Sign in");
      await page.keyboard.press("Escape");
      await expect(main(page, "Sign in to Stub Jellyfin")).toBeVisible();
      await expectFocus(page, "Another user");
      await page.keyboard.press("Escape");
      await expect(main(page, "Find your server")).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Server address" })).toHaveValue(
        `http://${stub.address}/`
      );
      await expectFocus(page, "q");
      await page.keyboard.press("Escape");
      await expect(main(page, "Welcome")).toBeVisible();
      await expectFocus(page, "Begin");
    } finally {
      await stub.close();
    }
  });
});
