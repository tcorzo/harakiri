export class MpvClosedError extends Error {
  constructor() {
    super("mpv IPC connection closed");
    this.name = "MpvClosedError";
  }
}
