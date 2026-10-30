/**
 * A Jellyfin answer with an HTTP error status, raised by the main process's and the renderer's
 * clients as the response arrives (ky 2 consumes an error body before the generated client reads
 * it, which would otherwise lose the status behind "body already used").
 */
export class ServerStatusError extends Error {
  override readonly name = "ServerStatusError";
  readonly status: number;

  /** `where` is the request URL or its path. Only the path is kept: a query can carry an api_key. */
  constructor(status: number, where: string) {
    super(`The server answered ${status} for ${new URL(where, "http://server.invalid").pathname}`);
    this.status = status;
  }
}

/** What Electron puts before a handler's error message: `Error invoking remote method 'x': Name: `. */
const ipcWrapper = /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/;
const statusMessage = /^The server answered (\d{3}) for (\S+)$/;

/**
 * Electron carries only a handler error's message across IPC, wrapped in its own words. This
 * unwraps it, and rebuilds a `ServerStatusError` so the renderer still knows the status.
 */
export function fromIpc(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const message = error.message.replace(ipcWrapper, "");
  const status = statusMessage.exec(message);
  if (status?.[1] !== undefined && status[2] !== undefined) {
    return new ServerStatusError(Number(status[1]), status[2]);
  }
  return message === error.message ? error : new Error(message);
}
