import { AccessToken, DeviceId, ServerUrl, UserId } from "@harakiri/jellyfin";
import { expect, test } from "vitest";

import { initialOnboarding, isServerSupported, serverCandidates, onboarding } from "./machine";
import type { OnboardingEvent, OnboardingState, ServerInfo } from "./machine";

const server: ServerInfo = {
  url: "http://127.0.0.1:8096/",
  id: "472bf7c557354af98b94556a9979bb62",
  name: "harakiri-dev",
  version: "12.4.0",
};

const session = {
  serverUrl: ServerUrl.parse("http://127.0.0.1:8096/"),
  serverId: server.id,
  serverName: server.name,
  serverVersion: server.version,
  userId: UserId.parse("54fc2b5a969742d1961c5188cf5c2e66"),
  userName: "harakiri",
  accessToken: AccessToken.parse("token"),
  deviceId: DeviceId.parse("device"),
};

function run(...events: OnboardingEvent[]): OnboardingState {
  return events.reduce(onboarding, initialOnboarding);
}

test("serverCandidates tries HTTPS and Jellyfin's port for an address typed without a scheme", () => {
  expect(serverCandidates("192.168.1.20")).toEqual([
    "https://192.168.1.20/",
    "http://192.168.1.20:8096/",
  ]);
  expect(serverCandidates("jellyfin.example.com")).toEqual([
    "https://jellyfin.example.com/",
    "http://jellyfin.example.com:8096/",
  ]);
  expect(serverCandidates(" jellyfin.local:9000 ")).toEqual([
    "https://jellyfin.local:9000/",
    "http://jellyfin.local:9000/",
  ]);
  expect(serverCandidates("nas/jellyfin")).toEqual([
    "https://nas/jellyfin/",
    "http://nas:8096/jellyfin/",
  ]);
  expect(serverCandidates("https://films.example.org")).toEqual(["https://films.example.org/"]);
  expect(serverCandidates("http://nas/jellyfin")).toEqual(["http://nas/jellyfin/"]);
  expect(serverCandidates("")).toBe(null);
  expect(serverCandidates("ftp://nas")).toBe(null);
  expect(serverCandidates("http://")).toBe(null);
});

test("servers older than 10.10 are refused", () => {
  expect(isServerSupported("12.4.0")).toBe(true);
  expect(isServerSupported("10.10.3")).toBe(true);
  expect(isServerSupported("10.9.11")).toBe(false);
  expect(isServerSupported("unknown")).toBe(false);
});

test("a typed address is checked, then the server leads to choosing a user", () => {
  const typed = run({ type: "begin" }, { type: "edit", text: "127.0.0.1" });
  expect(typed).toEqual({ step: "server", address: "127.0.0.1" });

  const checking = onboarding(typed, { type: "submitAddress" });
  expect(checking).toEqual({
    step: "checking",
    address: "127.0.0.1",
    urls: ["https://127.0.0.1/", "http://127.0.0.1:8096/"],
  });

  expect(onboarding(checking, { type: "serverFound", address: "127.0.0.1", info: server })).toEqual(
    { step: "chooseUser", server }
  );
});

test("an unparseable address never leaves the server step", () => {
  expect(run({ type: "begin" }, { type: "edit", text: "  " }, { type: "submitAddress" })).toEqual({
    step: "server",
    address: "  ",
    problem: { kind: "invalid" },
  });
});

test("an unreachable or too-old server returns to the address with the problem", () => {
  const checking = run({ type: "begin" }, { type: "pickServer", address: "http://10.0.0.9:8096" });
  expect(
    onboarding(checking, {
      type: "serverFailed",
      address: "http://10.0.0.9:8096",
      problem: { kind: "tooOld", version: "10.8.13" },
    })
  ).toEqual({
    step: "server",
    address: "http://10.0.0.9:8096",
    problem: { kind: "tooOld", version: "10.8.13" },
  });
});

test("a late answer for an address the owner backed out of is ignored", () => {
  const checking = run({ type: "begin" }, { type: "pickServer", address: "10.0.0.9" });
  const backedOut = onboarding(checking, { type: "back" });
  expect(backedOut).toEqual({ step: "server", address: "10.0.0.9" });
  expect(onboarding(backedOut, { type: "serverFound", address: "10.0.0.9", info: server })).toEqual(
    { step: "server", address: "10.0.0.9" }
  );

  const other = onboarding(checking, {
    type: "serverFound",
    address: "10.0.0.1",
    info: server,
  });

  expect(other).toEqual(checking);
});

test("a wrong password clears the field and says so; back walks to the user list", () => {
  const chosen: OnboardingState = { step: "chooseUser", server };

  const typing = [
    { type: "pickUser", username: "harakiri", hasPassword: true },
    { type: "edit", text: "wrong" },
    { type: "submitPassword" },
  ] satisfies OnboardingEvent[];

  const authenticating = typing.reduce(onboarding, chosen);
  expect(authenticating).toEqual({
    step: "authenticating",
    server,
    username: "harakiri",
    password: "wrong",
  });

  const failed = onboarding(authenticating, { type: "signInFailed", problem: "wrongPassword" });
  expect(failed).toEqual({
    step: "password",
    server,
    username: "harakiri",
    password: "",
    problem: "wrongPassword",
  });
  expect(onboarding(failed, { type: "back" })).toEqual({ step: "chooseUser", server });
});

test("a user without a password signs in straight from the list", () => {
  expect(
    onboarding(
      { step: "chooseUser", server },
      { type: "pickUser", username: "guest", hasPassword: false }
    )
  ).toEqual({ step: "authenticating", server, username: "guest", password: "" });
});

test("another user types a name first, and a blank name is not accepted", () => {
  const named = [
    { type: "otherUser" },
    { type: "submitUsername" },
    { type: "edit", text: " ana " },
  ] satisfies OnboardingEvent[];

  const state = named.reduce(onboarding, { step: "chooseUser", server } as OnboardingState);
  expect(state).toEqual({ step: "username", server, username: " ana " });
  expect(onboarding(state, { type: "submitUsername" })).toEqual({
    step: "password",
    server,
    username: "ana",
    password: "",
  });
});

test("Quick Connect shows its code and finishes with a session", () => {
  const started = onboarding({ step: "chooseUser", server }, { type: "startQuickConnect" });
  const coded = onboarding(started, { type: "quickConnectCode", code: "482913" });
  expect(coded).toEqual({ step: "quickConnect", server, code: "482913" });
  expect(onboarding(coded, { type: "signedIn", session })).toEqual({ step: "done", session });
});

test("back from the server step returns to the welcome", () => {
  expect(run({ type: "begin" }, { type: "back" })).toEqual({ step: "welcome" });
  expect(run({ type: "back" })).toEqual({ step: "welcome" });
});
