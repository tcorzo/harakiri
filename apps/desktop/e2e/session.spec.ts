import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./support/harakiri";

test("a seeded session is read back whole, with the profile's device id", async ({
  launch,
  signIn,
  account,
}) => {
  signIn();
  const { page } = await launch();

  const [session, deviceId] = await page.evaluate(() =>
    Promise.all([window.harakiri.session.get(), window.harakiri.deviceId()]),
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

  await first.page.evaluate(() => window.harakiri.session.clear());

  expect(await first.page.evaluate(() => window.harakiri.session.get())).toBeNull();
  expect(existsSync(join(userDataDir, "session.json"))).toBe(false);
  await first.app.close();
  const second = await launch();
  expect(await second.page.evaluate(() => window.harakiri.session.get())).toBeNull();
  expect(await second.page.evaluate(() => window.harakiri.deviceId())).toBe(account.deviceId);
});

test("a session saved through the bridge survives a restart", async ({ launch, account }) => {
  const { accessToken, deviceId: _, ...rest } = account;
  const first = await launch();
  const deviceId = await first.page.evaluate(() => window.harakiri.deviceId());

  await first.page.evaluate((session) => window.harakiri.session.save(session), {
    ...rest,
    accessToken,
  });
  await first.app.close();

  const second = await launch();
  expect(await second.page.evaluate(() => window.harakiri.session.get())).toEqual({
    ...rest,
    accessToken,
    deviceId,
  });
});

test("an unreadable session file reads as signed out and the app keeps working", async ({
  launch,
  signIn,
  account,
  userDataDir,
}) => {
  signIn();
  const { page } = await launch();
  const sessionFile = join(userDataDir, "session.json");
  const corrupt = [
    "{not json",
    JSON.stringify({ serverUrl: account.serverUrl }),
    JSON.stringify({ ...account, token: { kind: "rot13", value: "x" } }),
    // A token encrypted under another keyring, or garbage, fails to decrypt.
    JSON.stringify({ ...account, token: { kind: "encrypted", base64: "AAAA" } }),
  ];

  for (const contents of corrupt) {
    writeFileSync(sessionFile, contents);
    expect(await page.evaluate(() => window.harakiri.session.get()), contents).toBeNull();
  }

  expect(await page.evaluate(() => window.harakiri.deviceId())).toBe(account.deviceId);
  signIn();
  expect(await page.evaluate(() => window.harakiri.session.get())).toEqual(account);
});
