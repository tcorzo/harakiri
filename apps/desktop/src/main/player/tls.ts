/** What the owner reads when mpv's libcurl refused the server's certificate. */
export const CERTIFICATE_NOT_TRUSTED = "The server's certificate is not trusted";

/**
 * True for mpv's log line when libcurl refused the server's certificate. The bundled mpv logs, with
 * prefix `curl` at `error`, "SSL peer certificate or SSH remote key was not OK" and then
 * "TLS certificate verification failed." (libcurl's CURLE_PEER_FAILED_VERIFICATION).
 */
export const isCertificateRejection = (line: {
  readonly prefix: string;
  readonly level: string;
  readonly text: string;
}): boolean =>
  line.prefix.startsWith("curl") &&
  (line.level === "error" || line.level === "fatal") &&
  /certificate/iu.test(line.text);
