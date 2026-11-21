import { renderers } from "@harakiri/fidelity";
import type { Downgrade as FidelityDowngrade } from "@harakiri/fidelity";
import {
  AccessToken,
  DeviceId,
  ItemId,
  MediaSourceId,
  ServerUrl,
  signalStates,
  UserId,
} from "@harakiri/jellyfin";
import type { SignalFact as FidelityFact } from "@harakiri/jellyfin";
import { z } from "zod";

export const channels = {
  sessionGet: "session:get",
  sessionSave: "session:save",
  sessionClear: "session:clear",
  deviceId: "device:id",
  updateStatus: "updates:status",
  updateRestart: "updates:restart",
  discover: "server:discover",
  prepare: "player:prepare",
  play: "player:play",
  stop: "player:stop",
  playerEvent: "player:event",
  testProbe: "test:probe",
} as const;

/**
 * A signed-in Jellyfin session. The main process persists it with the token encrypted by safeStorage.
 * The renderer receives the token by design: it calls Jellyfin directly for the browse UI.
 */
export const Session = z.object({
  serverUrl: ServerUrl,
  serverId: z.string(),
  serverName: z.string(),
  serverVersion: z.string(),
  userId: UserId,
  userName: z.string(),
  accessToken: AccessToken,
  /** Injected by the main process from its one stored device id; the renderer never supplies it. */
  deviceId: DeviceId,
});

export type Session = z.output<typeof Session>;

/** What the renderer hands to `session.save`: a session without the device id, which main owns. */
export const NewSession = Session.omit({ deviceId: true });

export type NewSession = z.output<typeof NewSession>;

/** A server that answered Jellyfin's UDP discovery broadcast on port 7359. */
export const DiscoveredServer = z.object({
  id: z.string(),
  name: z.string(),
  address: ServerUrl,
});

export type DiscoveredServer = z.infer<typeof DiscoveredServer>;

/**
 * What the renderer asks the player to play. The main process resolves PlaybackInfo itself,
 * so the renderer only names the item and the user's choices.
 */
export const PlayRequest = z.object({
  itemId: ItemId,
  mediaSourceId: MediaSourceId.optional(),
  /** Omitted means from the start. */
  startPositionTicks: z.number().int().nonnegative().optional(),
  audioStreamIndex: z.number().int().optional(),
  subtitleStreamIndex: z.number().int().optional(),
});

export type PlayRequest = z.output<typeof PlayRequest>;

/** How a leg of the signal path reaches the TV or receiver, from the one list in `@harakiri/jellyfin`. */
export const SignalState = z.enum(signalStates);

export type SignalState = z.infer<typeof SignalState>;

/** One leg of the signal path, for example `{ text: "TrueHD Atmos bitstream", state: "native" }`. */
export const SignalFact = z.object({
  text: z.string(),
  state: SignalState,
}) satisfies z.ZodType<FidelityFact>;

export type SignalFact = FidelityFact;

const DowngradeReason = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("serverTranscode"), reasons: z.array(z.string()).readonly() }),
  z.object({ kind: z.literal("outputRefuses"), output: z.string() }),
  z.object({ kind: z.literal("outputUnknown"), detail: z.string() }),
  z.object({ kind: z.literal("outputFailed"), output: z.string().nullable() }),
  z.object({
    kind: z.literal("rendererFailed"),
    renderer: z.enum([...renderers, "none"]),
  }),
  z.object({ kind: z.literal("displaySdr") }),
  z.object({
    kind: z.literal("scaledDown"),
    output: z.object({ width: z.number(), height: z.number() }),
  }),
]) satisfies z.ZodType<FidelityDowngrade["reason"]>;

export const Downgrade = z.object({
  leg: z.enum(["picture", "sound"]),
  from: z.string(),
  to: z.string(),
  reason: DowngradeReason,
  message: z.string(),
}) satisfies z.ZodType<FidelityDowngrade>;

export type Downgrade = FidelityDowngrade;

/**
 * What the server decided for a play request, resolved by the main process from PlaybackInfo.
 * The handoff states it before mpv takes the screen, and `player.play` reuses the same resolution.
 */
export const SignalReport = z.object({
  /** The picture leg, then the sound leg, as they play. */
  facts: z.array(SignalFact),
  /** Every way the playback is below its best, and why (packages/fidelity). */
  downgrades: z.array(Downgrade),
  /** Plain-language reasons when the server transcodes instead of direct playing (PRD principle 1). */
  transcodeReasons: z.array(z.string()),
  /** The server holds no stream information for the file, so it cannot send it as it is. */
  unreadable: z.boolean(),
});

export type SignalReport = z.infer<typeof SignalReport>;

/**
 * `ended`, `stopped` and `error` arrive as soon as mpv has quit, so the screen comes back at once.
 * `reported` follows once the stop report to the server has settled (stored or failed), and is
 * always the last event of a playback: anything that refetches the resume point waits for it.
 */
export const PlayerPhase = z.enum([
  "starting",
  "playing",
  "paused",
  "ended",
  "stopped",
  "error",
  "reported",
]);

export type PlayerPhase = z.infer<typeof PlayerPhase>;

/** Pushed from main to the renderer whenever playback changes phase or position. */
export const PlayerEvent = SignalReport.extend({
  phase: PlayerPhase,
  itemId: z.string(),
  positionTicks: z.number().int().nonnegative(),
  durationTicks: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

export type PlayerEvent = z.infer<typeof PlayerEvent>;

/** Live mpv state for end-to-end tests. Only answered when HARAKIRI_E2E=1. */
export const PlayerProbe = z.object({
  running: z.boolean(),
  path: z.string().optional(),
  timePos: z.number().optional(),
  pause: z.boolean().optional(),
  aid: z.union([z.number(), z.literal(false)]).optional(),
  sid: z.union([z.number(), z.literal(false)]).optional(),
  audioCodec: z.string().optional(),
  audioSpdif: z.boolean().optional(),
  videoGamma: z.string().optional(),
  videoPrimaries: z.string().optional(),
  osdVisible: z.boolean().optional(),
});

export type PlayerProbe = z.infer<typeof PlayerProbe>;

export const UpdateStatus = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unsupported") }),
  z.object({ state: z.literal("idle") }),
  z.object({ state: z.literal("available"), version: z.string() }),
  z.object({ state: z.literal("downloading"), version: z.string(), percent: z.number() }),
  z.object({ state: z.literal("ready"), version: z.string() }),
  z.object({ state: z.literal("failed"), message: z.string() }),
]);

export type UpdateStatus = z.infer<typeof UpdateStatus>;

/** What the preload exposes on `window.harakiri`. Every value crossing IPC is parsed with the schemas above. */
export interface HarakiriBridge {
  /**
   * The one device id for the Authorization header, stable across restarts and available before
   * sign-in. `session.get()` returns the same value in `deviceId`.
   */
  readonly deviceId: () => Promise<DeviceId>;
  readonly session: {
    readonly get: () => Promise<Session | null>;
    readonly save: (session: NewSession) => Promise<void>;
    readonly clear: () => Promise<void>;
  };
  readonly discover: () => Promise<DiscoveredServer[]>;
  readonly updates: {
    readonly status: () => Promise<UpdateStatus>;
    /** Quits and installs the downloaded update; does nothing unless one is ready. */
    readonly restart: () => Promise<void>;
  };
  readonly player: {
    /**
     * Resolves PlaybackInfo for the request and returns what the server decided, so the handoff
     * can state it. A following `play` with the same request reuses this resolution.
     */
    readonly prepare: (request: PlayRequest) => Promise<SignalReport>;
    /**
     * Resolves once mpv has accepted the file, and rejects if playback could not start.
     * Progress, the end of playback and later errors arrive through `onEvent`.
     */
    readonly play: (request: PlayRequest) => Promise<void>;
    readonly stop: () => Promise<void>;
    /** Events that fail to parse are logged and dropped. */
    readonly onEvent: (listener: (event: PlayerEvent) => void) => () => void;
  };
  /** Present only when the main process runs with HARAKIRI_E2E=1. */
  readonly test?: {
    readonly probe: () => Promise<PlayerProbe>;
  };
}
