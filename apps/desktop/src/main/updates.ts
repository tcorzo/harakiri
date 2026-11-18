import { getLogger } from "@logtape/logtape";
import type { UpdateStatus } from "../shared/bridge";

const log = getLogger(["harakiri", "updates"]);

export interface UpdaterLike {
  check(): Promise<unknown>;
  download(): Promise<unknown>;
  /** Synchronous; swaps the AppImage. `relaunch` starts the new one. */
  install(relaunch: boolean): boolean;
  onAvailable(listener: (version: string) => void): void;
  onNotAvailable(listener: () => void): void;
  onProgress(listener: (percent: number) => void): void;
  onDownloaded(listener: (version: string) => void): void;
  onError(listener: (error: Error) => void): void;
}

export interface UpdateDeps {
  readonly appImage: string | undefined;
  /** Called only when appImage is set. */
  readonly createUpdater: () => UpdaterLike;
  readonly isPlaying: () => boolean;
  readonly releaseLock: () => void;
  /** Quits the app; the quit hold stops mpv and then installs. */
  readonly quit: () => void;
  readonly checkEveryMs?: number; // 21_600_000
  readonly idlePollMs?: number; // 60_000
}

export interface Updates {
  status(): UpdateStatus;
  installIfReady(): void;
  /** Quits and relaunches into the downloaded update; does nothing unless one is ready. */
  restart(): void;
}

const CHECK_EVERY_MS = 21_600_000;
const IDLE_POLL_MS = 60_000;

// The error event sets the status, so a rejected promise only needs logging.
const swallow = (what: string) => (error: unknown) => {
  log.debug("update {what} rejected: {error}", { what, error });
};

export function startUpdates(deps: UpdateDeps): Updates {
  if (deps.appImage === undefined) {
    return {
      status: () => ({ state: "unsupported" }),
      installIfReady: () => {},
      restart: () => {},
    };
  }

  const updater = deps.createUpdater();
  let status: UpdateStatus = { state: "idle" };
  let relaunch = false;

  const set = (next: UpdateStatus): void => {
    status = next;
    log.info("update status {status}", { status: next });
  };

  const check = (): void => {
    updater.check().catch(swallow("check"));
  };

  const download = (version: string): void => {
    set({ state: "downloading", version, percent: 0 });
    updater.download().catch((error: unknown) => {
      swallow("download")(error);
      if (status.state !== "downloading") return;
      const message = error instanceof Error ? error.message : String(error);
      set({ state: "failed", message });
      log.warn("update download failed: {message}", { message });
    });
  };

  updater.onAvailable((version) => {
    set({ state: "available", version });
    if (!deps.isPlaying()) download(version);
  });
  updater.onNotAvailable(() => set({ state: "idle" }));
  updater.onProgress((percent) => {
    if (status.state === "downloading") {
      status = { state: "downloading", version: status.version, percent };
    }
  });
  updater.onDownloaded((version) => set({ state: "ready", version }));
  updater.onError((error) => set({ state: "failed", message: error.message }));

  check();
  setInterval(() => {
    if (status.state !== "downloading" && status.state !== "ready") check();
  }, deps.checkEveryMs ?? CHECK_EVERY_MS);
  setInterval(() => {
    if (status.state === "available" && !deps.isPlaying()) download(status.version);
  }, deps.idlePollMs ?? IDLE_POLL_MS);

  return {
    status: () => status,
    restart: () => {
      if (status.state !== "ready") return;
      relaunch = true;
      deps.quit();
    },
    installIfReady: () => {
      if (status.state !== "ready") return;
      if (relaunch) deps.releaseLock();
      try {
        updater.install(relaunch);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ state: "failed", message });
        log.error("update install failed: {message}", { message });
      }
    },
  };
}
