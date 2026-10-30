import { match } from "ts-pattern";
import {
  type Downgrade,
  type DowngradeReason,
  type Fact,
  type PictureSource,
  type Renderer,
  renderers,
} from "./model";

/** What is known about the picture path. */
export interface PictureWorld {
  /** The renderer mpv uses now; "none" once every renderer has failed. */
  readonly renderer: Renderer | "none";
  /** What the display took, once mpv has said. */
  readonly display: "unknown" | "hdr" | "sdr";
}

export interface PictureResult {
  readonly fact: Fact | null;
  readonly downgrade: Downgrade | null;
}

/** The renderer to try after `renderer` fails, or "none". */
export function nextRenderer(renderer: Renderer | "none"): Renderer | "none" {
  if (renderer === "none") return "none";
  return renderers[renderers.indexOf(renderer) + 1] ?? "none";
}

/** The fact for a picture at its best: HDR10 out, with Dolby Vision and HLG mapped to it. */
export function bestPictureFact(picture: PictureSource): Fact {
  return match(picture.range)
    .with("SDR", "HDR10", "HDR10+", (range): Fact => ({ text: range, state: "native" }))
    .with("HLG", "Dolby Vision", (): Fact => ({
      text: `${picture.label} mapped to HDR10`,
      state: "mapped",
    }))
    .exhaustive();
}

const RENDERER_NAMES: Readonly<Record<Renderer, string>> = {
  vulkan: "Vulkan",
  opengl: "OpenGL",
  "opengl-legacy": "the legacy OpenGL renderer",
};

function message(reason: DowngradeReason, picture: PictureSource): string {
  return match(reason)
    .with(
      { kind: "displaySdr" },
      () => `The display takes SDR only, so ${picture.label} is tone-mapped to SDR.`,
    )
    .with({ kind: "rendererFailed" }, ({ renderer }) =>
      renderer === "none"
        ? "No video renderer could start. The sound carries on without a picture."
        : `Vulkan could not start, so harakiri renders with ${RENDERER_NAMES[renderer]}, which cannot send HDR. ${picture.label} is tone-mapped to SDR.`,
    )
    .otherwise(() => "");
}

/** Decides how the picture reaches the display, and why when it is less than its best. */
export function picturePlan(picture: PictureSource | null, world: PictureWorld): PictureResult {
  if (picture === null) return { fact: null, downgrade: null };
  const best = bestPictureFact(picture);
  const lowered = (fact: Fact, reason: DowngradeReason): PictureResult => ({
    fact,
    downgrade: {
      leg: "picture",
      from: best.text,
      to: fact.text,
      reason,
      message: message(reason, picture),
    },
  });

  if (world.renderer === "none") {
    return lowered(
      { text: "No picture", state: "mapped" },
      { kind: "rendererFailed", renderer: "none" },
    );
  }
  if (picture.range === "SDR") return { fact: best, downgrade: null };
  const toneMapped: Fact = { text: `${picture.label} tone-mapped to SDR`, state: "mapped" };
  // Only Vulkan hands HDR to the compositor, so any other renderer tone-maps whatever the display.
  if (world.renderer !== "vulkan") {
    return lowered(toneMapped, { kind: "rendererFailed", renderer: world.renderer });
  }
  if (world.display === "sdr") return lowered(toneMapped, { kind: "displaySdr" });
  return { fact: best, downgrade: null };
}
