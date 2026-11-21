import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, expectFocus, test } from "./support/harakiri";

test("a seeded session is read back whole, with the profile's device id", async ({
  launch,
  signIn,
  account,
}) => {
  signIn();
  const { page } = await launch();

  const [session, deviceId] = await page.evaluate(
    async () => await Promise.all([window.harakiri.session.get(), window.harakiri.deviceId()])
  );

  expect(session).toEqual(account);
  expect(deviceId).toBe(account.deviceId);
});

test("signing out clears the session for good but keeps the device id", async ({
  launch,
  signIn,
  account,
  userDataDir,
}) => {
  signIn();
  const first = await launch();

  await first.page.evaluate(async () => {
    await window.harakiri.session.clear();
  });

  expect(await first.page.evaluate(async () => await window.harakiri.session.get())).toBeNull();
  expect(existsSync(path.join(userDataDir, "session.json"))).toBe(false);
  await first.app.close();
  const second = await launch();
  expect(await second.page.evaluate(async () => await window.harakiri.session.get())).toBeNull();
  expect(await second.page.evaluate(async () => await window.harakiri.deviceId())).toBe(
    account.deviceId
  );
});

test("a session saved through the bridge survives a restart", async ({ launch, account }) => {
  const { accessToken, deviceId: _, ...rest } = account;
  const first = await launch();
  const deviceId = await first.page.evaluate(async () => await window.harakiri.deviceId());

  await first.page.evaluate(
    async (session) => {
      await window.harakiri.session.save(session);
    },
    {
      ...rest,
      accessToken,
    }
  );
  await first.app.close();

  const second = await launch();
  expect(await second.page.evaluate(async () => await window.harakiri.session.get())).toEqual({
    ...rest,
    accessToken,
    deviceId,
  });
});

test("a sign-in saved without a keyring survives a restart, and Settings says where it is kept", async ({
  launch,
  account,
  userDataDir,
}) => {
  const { deviceId, ...newSession } = account;
  // The profile runs on the worker's device, so the relaunch's session is the account itself.
  writeFileSync(path.join(userDataDir, "device-id"), deviceId, { mode: 0o600 });
  const first = await launch();

  await first.page.evaluate(async (session) => {
    await window.harakiri.session.save(session);
  }, newSession);
  expect(await first.page.evaluate(async () => await window.harakiri.session.storage())).toBe(
    "file"
  );

  const sessionFile = path.join(userDataDir, "session.json");
  expect(JSON.parse(readFileSync(sessionFile, "utf-8"))).toMatchObject({
    token: { kind: "obfuscated" },
  });
  expect(statSync(sessionFile).mode.toString(8).slice(-3)).toBe("600");
  await first.app.close();

  const { page } = await launch();
  expect(await page.evaluate(async () => await window.harakiri.session.get())).toEqual(account);

  await expect(page.getByRole("main", { name: "Library", exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expectFocus(page, /^(?:Play|Resume) \S/u, 10_000);
  await page.keyboard.press("ArrowUp");
  await expectFocus(page, "Settings");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByText("Signed in on this device without a keyring")).toBeVisible();
});

test("an unreadable session file reads as signed out and the app keeps working", async ({
  launch,
  signIn,
  account,
  userDataDir,
}) => {
  signIn();
  const { page } = await launch();
  const sessionFile = path.join(userDataDir, "session.json");

  const corrupt = [
    "{not json",
    JSON.stringify({ serverUrl: account.serverUrl }),
    JSON.stringify({ ...account, token: { kind: "rot13", value: "x" } }),
    // A token encrypted under another keyring, or garbage, fails to decrypt.
    JSON.stringify({ ...account, token: { kind: "encrypted", base64: "AAAA" } }),
  ];

  /* oxlint-disable eslint/no-await-in-loop -- each corrupt file is written, read back and judged in turn */
  for (const contents of corrupt) {
    writeFileSync(sessionFile, contents);
    expect(
      await page.evaluate(async () => await window.harakiri.session.get()),
      contents
    ).toBeNull();
  }
  /* oxlint-enable eslint/no-await-in-loop */

  expect(await page.evaluate(async () => await window.harakiri.deviceId())).toBe(account.deviceId);
  signIn();
  expect(await page.evaluate(async () => await window.harakiri.session.get())).toEqual(account);
});
