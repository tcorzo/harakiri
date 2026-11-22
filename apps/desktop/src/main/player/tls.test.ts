import { describe, expect, it } from "vitest";

import { isCertificateRejection } from "./tls";

// Recorded from the bundled mpv opening https://127.0.0.1 with a self-signed certificate.
const RECORDED = {
  prefix: "curl",
  level: "error",
  text: "SSL peer certificate or SSH remote key was not OK\n",
} as const;

describe(isCertificateRejection, () => {
  it("mpv's line for a refused certificate is a rejection", () => {
    expect(isCertificateRejection(RECORDED)).toBe(true);
  });

  it("so is the line that explains the verification failure", () => {
    expect(
      isCertificateRejection({
        prefix: "curl",
        level: "error",
        text: "TLS certificate verification failed.\n",
      })
    ).toBe(true);
  });

  it.each([
    { prefix: RECORDED.prefix, level: "error", text: "HTTP error 404" },
    { prefix: "ffmpeg", level: "warn", text: "Invalid data found when processing input" },
    { prefix: "ffmpeg", level: "error", text: "certificate verify failed" },
    { prefix: RECORDED.prefix, level: "warn", text: RECORDED.text },
  ])("an unrelated failure is not: %j", (line) => {
    expect(isCertificateRejection(line)).toBe(false);
  });
});
