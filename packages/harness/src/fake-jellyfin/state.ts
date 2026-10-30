import { randomBytes, randomInt } from "node:crypto";
import { fakeId } from "./library";

/**
 * Everything the fake remembers, per server instance: users, the token each device holds,
 * what each device is playing, every user's resume state, and pending Quick Connect requests.
 * Nothing is shared between instances, so a test that wants a clean server starts its own.
 */

export interface FakeUser {
  readonly id: string;
  readonly name: string;
  password: string;
  isHidden: boolean;
  readonly isAdministrator: boolean;
  lastLoginDate: string | undefined;
}

export interface Client {
  readonly client: string;
  readonly device: string;
  readonly deviceId: string;
  readonly version: string;
}

export interface Device extends Client {
  readonly userId: string;
  readonly token: string;
  readonly sessionId: string;
  lastActivity: string;
  nowPlaying: NowPlaying | undefined;
}

export interface NowPlaying {
  readonly itemId: string;
  readonly mediaSourceId: string | undefined;
  readonly playSessionId: string | undefined;
  readonly playMethod: string;
  positionTicks: number;
  isPaused: boolean;
  audioStreamIndex: number | undefined;
  subtitleStreamIndex: number | undefined;
}

export interface UserData {
  playbackPositionTicks: number;
  playCount: number;
  isFavorite: boolean;
  played: boolean;
  lastPlayedDate: string | undefined;
}

export interface QuickConnectRequest extends Client {
  readonly secret: string;
  readonly code: string;
  readonly dateAdded: string;
  authorizedUserId: string | undefined;
}

export interface UserSpec {
  readonly name: string;
  readonly password: string;
  /** Hidden users are left out of /Users/Public (the dev server's user is hidden). */
  readonly hidden?: boolean;
  readonly administrator?: boolean;
}

export const hex32 = () => randomBytes(16).toString("hex");

export class FakeState {
  readonly users: FakeUser[];
  /** One token per device id, as Jellyfin keeps them: a new sign-in replaces the old token. */
  readonly devices = new Map<string, Device>();
  readonly userData = new Map<string, UserData>();
  readonly quickConnect = new Map<string, QuickConnectRequest>();
  quickConnectEnabled = true;

  constructor(users: readonly UserSpec[]) {
    this.users = users.map((u) => ({
      id: fakeId(`user:${u.name}`),
      name: u.name,
      password: u.password,
      isHidden: u.hidden ?? true,
      isAdministrator: u.administrator ?? true,
      lastLoginDate: undefined,
    }));
  }

  user(id: string): FakeUser | undefined {
    return this.users.find((u) => u.id === id.replaceAll("-", ""));
  }

  userByName(name: string): FakeUser | undefined {
    return this.users.find((u) => u.name.toLowerCase() === name.toLowerCase());
  }

  /** Issues a token for the device, revoking whatever token it held before. */
  signIn(user: FakeUser, client: Client): Device {
    const now = new Date().toISOString();
    user.lastLoginDate = now;
    const device: Device = {
      ...client,
      userId: user.id,
      token: hex32(),
      sessionId: hex32(),
      lastActivity: now,
      nowPlaying: undefined,
    };
    this.devices.set(client.deviceId, device);
    return device;
  }

  byToken(token: string): Device | undefined {
    for (const device of this.devices.values()) if (device.token === token) return device;
    return undefined;
  }

  revoke(deviceId: string): boolean {
    return this.devices.delete(deviceId);
  }

  data(userId: string, itemId: string): UserData {
    const key = `${userId}:${itemId}`;
    const found = this.userData.get(key);
    if (found) return found;
    const fresh: UserData = {
      playbackPositionTicks: 0,
      playCount: 0,
      isFavorite: false,
      played: false,
      lastPlayedDate: undefined,
    };
    this.userData.set(key, fresh);
    return fresh;
  }

  initiateQuickConnect(client: Client): QuickConnectRequest {
    const request: QuickConnectRequest = {
      ...client,
      secret: randomBytes(32).toString("hex"),
      code: String(randomInt(0, 1_000_000)).padStart(6, "0"),
      dateAdded: new Date().toISOString(),
      authorizedUserId: undefined,
    };
    this.quickConnect.set(request.secret, request);
    return request;
  }

  /** Forgets every user's resume state and what any device is playing; tokens stay valid. */
  resetPlayState(): void {
    this.userData.clear();
    this.quickConnect.clear();
    for (const device of this.devices.values()) device.nowPlaying = undefined;
  }
}

// Jellyfin's defaults (ServerConfiguration: MinResumePct, MaxResumePct, MinResumeDurationSeconds).
const MIN_RESUME_PCT = 5;
const MAX_RESUME_PCT = 90;
const MIN_RESUME_SECONDS = 300;
const TICKS_PER_SECOND = 10_000_000;

/**
 * Jellyfin's UserDataManager.UpdatePlayState, run on every progress and stop report: a position in
 * the first 5% is dropped, one past 90% (or in the last second) marks the item played, and an item
 * under 5 minutes never keeps one.
 */
export function updatePlayState(data: UserData, runTimeTicks: number, reported: number): void {
  let position = reported;
  let played = false;
  if (position > 0 && runTimeTicks > 0) {
    const pct = (position / runTimeTicks) * 100;
    if (pct < MIN_RESUME_PCT) position = 0;
    else if (pct > MAX_RESUME_PCT || position >= runTimeTicks - TICKS_PER_SECOND) {
      position = 0;
      played = true;
    } else if (runTimeTicks / TICKS_PER_SECOND < MIN_RESUME_SECONDS) {
      position = 0;
      played = true;
    }
  } else if (runTimeTicks <= 0) {
    position = 0;
    played = true;
  }
  data.playbackPositionTicks = position;
  if (played) data.played = true;
}

/** SessionManager.OnPlaybackStart: a start counts a play and dates it, and unmarks the item played. */
export function startPlayState(data: UserData): void {
  data.playCount += 1;
  data.lastPlayedDate = new Date().toISOString();
  data.played = false;
}
