import { AccessToken, DeviceId, ServerUrl, UserId } from "@harakiri/jellyfin";
import { describe, expect, it } from "vitest";

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

const fold = (events: readonly OnboardingEvent[], from: OnboardingState): OnboardingState => {
  let state = from;

  for (const event of events) {
    state = onboarding(state, event);
  }

  return state;
};

const run = (...events: OnboardingEvent[]): OnboardingState => fold(events, initialOnboarding);

describe("machine", () => {
  it("serverCandidates tries HTTPS and Jellyfin's port for an address typed without a scheme", () => {
    expect(serverCandidates("192.168.1.20")).toStrictEqual([
      "https://192.168.1.20/",
      "http://192.168.1.20:8096/",
    ]);
    expect(serverCandidates("jellyfin.example.com")).toStrictEqual([
      "https://jellyfin.example.com/",
      "http://jellyfin.example.com:8096/",
    ]);
    expect(serverCandidates(" jellyfin.local:9000 ")).toStrictEqual([
      "https://jellyfin.local:9000/",
      "http://jellyfin.local:9000/",
    ]);
    expect(serverCandidates("nas/jellyfin")).toStrictEqual([
      "https://nas/jellyfin/",
      "http://nas:8096/jellyfin/",
    ]);
  });

  it("serverCandidates keeps a typed scheme and refuses what is not an address", () => {
    expect(serverCandidates("https://films.example.org")).toStrictEqual([
      "https://films.example.org/",
    ]);
    expect(serverCandidates("http://nas/jellyfin")).toStrictEqual(["http://nas/jellyfin/"]);
    expect(serverCandidates("")).toBeNull();
    expect(serverCandidates("ftp://nas")).toBeNull();
    expect(serverCandidates("http://")).toBeNull();
  });

  it("servers older than 10.10 are refused", () => {
    expect(isServerSupported("12.4.0")).toBe(true);
    expect(isServerSupported("10.10.3")).toBe(true);
    expect(isServerSupported("10.9.11")).toBe(false);
    expect(isServerSupported("unknown")).toBe(false);
  });

  it("a typed address is checked, then the server leads to choosing a user", () => {
    const typed = run({ type: "begin" }, { type: "edit", text: "127.0.0.1" });
    expect(typed).toStrictEqual({ step: "server", address: "127.0.0.1" });

    const checking = onboarding(typed, { type: "submitAddress" });
    expect(checking).toStrictEqual({
      step: "checking",
      address: "127.0.0.1",
      urls: ["https://127.0.0.1/", "http://127.0.0.1:8096/"],
    });

    expect(
      onboarding(checking, { type: "serverFound", address: "127.0.0.1", info: server })
    ).toStrictEqual({ step: "chooseUser", server });
  });

  it("an unparseable address never leaves the server step", () => {
    expect(
      run({ type: "begin" }, { type: "edit", text: "  " }, { type: "submitAddress" })
    ).toStrictEqual({
      step: "server",
      address: "  ",
      problem: { kind: "invalid" },
    });
  });

  it("an unreachable or too-old server returns to the address with the problem", () => {
    const checking = run(
      { type: "begin" },
      { type: "pickServer", address: "http://10.0.0.9:8096" }
    );

    expect(
      onboarding(checking, {
        type: "serverFailed",
        address: "http://10.0.0.9:8096",
        problem: { kind: "tooOld", version: "10.8.13" },
      })
    ).toStrictEqual({
      step: "server",
      address: "http://10.0.0.9:8096",
      problem: { kind: "tooOld", version: "10.8.13" },
    });
  });

  it("a late answer for an address the owner backed out of is ignored", () => {
    const checking = run({ type: "begin" }, { type: "pickServer", address: "10.0.0.9" });
    const backedOut = onboarding(checking, { type: "back" });
    expect(backedOut).toStrictEqual({ step: "server", address: "10.0.0.9" });
    expect(
      onboarding(backedOut, { type: "serverFound", address: "10.0.0.9", info: server })
    ).toStrictEqual({ step: "server", address: "10.0.0.9" });

    const other = onboarding(checking, {
      type: "serverFound",
      address: "10.0.0.1",
      info: server,
    });

    expect(other).toStrictEqual(checking);
  });

  it("a wrong password clears the field and says so; back walks to the user list", () => {
    const chosen: OnboardingState = { step: "chooseUser", server };

    const typing = [
      { type: "pickUser", username: "harakiri", hasPassword: true },
      { type: "edit", text: "wrong" },
      { type: "submitPassword" },
    ] satisfies OnboardingEvent[];

    const authenticating = fold(typing, chosen);
    expect(authenticating).toStrictEqual({
      step: "authenticating",
      server,
      username: "harakiri",
      password: "wrong",
    });

    const failed = onboarding(authenticating, { type: "signInFailed", problem: "wrongPassword" });
    expect(failed).toStrictEqual({
      step: "password",
      server,
      username: "harakiri",
      password: "",
      problem: "wrongPassword",
    });
    expect(onboarding(failed, { type: "back" })).toStrictEqual({ step: "chooseUser", server });
  });

  it("a user without a password signs in straight from the list", () => {
    expect(
      onboarding(
        { step: "chooseUser", server },
        { type: "pickUser", username: "guest", hasPassword: false }
      )
    ).toStrictEqual({ step: "authenticating", server, username: "guest", password: "" });
  });

  it("another user types a name first, and a blank name is not accepted", () => {
    const named = [
      { type: "otherUser" },
      { type: "submitUsername" },
      { type: "edit", text: " ana " },
    ] satisfies OnboardingEvent[];

    const state = fold(named, { step: "chooseUser", server });
    expect(state).toStrictEqual({ step: "username", server, username: " ana " });
    expect(onboarding(state, { type: "submitUsername" })).toStrictEqual({
      step: "password",
      server,
      username: "ana",
      password: "",
    });
  });

  it("Quick Connect shows its code and finishes with a session", () => {
    const started = onboarding({ step: "chooseUser", server }, { type: "startQuickConnect" });
    const coded = onboarding(started, { type: "quickConnectCode", code: "482913" });
    expect(coded).toStrictEqual({ step: "quickConnect", server, code: "482913" });
    expect(onboarding(coded, { type: "signedIn", session })).toStrictEqual({
      step: "done",
      session,
    });
  });

  it("back from the server step returns to the welcome", () => {
    expect(run({ type: "begin" }, { type: "back" })).toStrictEqual({ step: "welcome" });
    expect(run({ type: "back" })).toStrictEqual({ step: "welcome" });
  });
});
