/**
 * Changing what the horizon shows: one backdrop giving way to another.
 *
 * The band above the field is where the eye reads *where it is* - sky, the
 * inside of a cave, the far side of a portal, open air under a flyer, the
 * murk of deep water. Going from one to the next is the same job every time,
 * so it is written once, here, and knows nothing about caves:
 *
 *     a transition  = from, to, a style, a start and a length   (`HorizonTransition`)
 *     its progress  = 0..1 over the clock, eased                (`transitionProgress`)
 *     each pixel    = shows `to` once progress passes its threshold   (`revealThreshold`)
 *
 * A threshold is a pure function of the *screen* pixel, so every surface that
 * takes part - the band, a floor laid over the field - reveals the same pixel
 * on the same frame and the change sweeps the frame as one picture. Each style
 * is a shape plus the 4x4 Bayer dither, so the moving edge is pixel art rather
 * than a blend, and no colour off the palette is ever made:
 *
 * | Style | Edge | Meant for |
 * | --- | --- | --- |
 * | `dissolve` | clumped noise breaking up everywhere at once | a cave, a door, a dream |
 * | `iris` | a ring opening from the centre of the screen | a portal |
 * | `flood` | a waterline rising from the bottom, rippled | diving under water |
 * | `descend` | a front falling from the top, rippled | taking off, falling asleep |
 *
 * Every threshold lies in `[0, 1)`, so progress 0 reveals nothing and progress
 * 1 reveals everything, whatever the style.
 */

import { compositeOver, type PixelBuffer } from "./pixel-buffer";
import { valueNoise2 } from "./procgen/noise";
import { ditherThreshold } from "./shading";

export type TransitionStyle = "dissolve" | "iris" | "flood" | "descend";

export const TRANSITION_STYLES: readonly TransitionStyle[] = ["dissolve", "iris", "flood", "descend"];

/** How long a change of horizon takes when the caller does not say, ms. */
export const DEFAULT_TRANSITION_MS = 900;

export interface HorizonTransition {
  /** The backdrop being left; any id the caller uses, the transition only carries it. */
  readonly from: string;
  readonly to: string;
  readonly style: TransitionStyle;
  readonly startMs: number;
  readonly durationMs: number;
}

export function beginTransition(
  from: string,
  to: string,
  style: TransitionStyle,
  startMs: number,
  durationMs: number = DEFAULT_TRANSITION_MS,
): HorizonTransition {
  return { from, to, style, startMs, durationMs: Math.max(1, durationMs) };
}

/** How far through, 0..1, eased in and out so the change starts and lands softly. */
export function transitionProgress(transition: HorizonTransition, nowMs: number): number {
  const linear = Math.min(Math.max((nowMs - transition.startMs) / transition.durationMs, 0), 1);
  return linear * linear * (3 - 2 * linear);
}

export function transitionDone(transition: HorizonTransition, nowMs: number): boolean {
  return nowMs - transition.startMs >= transition.durationMs;
}

/** Just under 1, so a threshold never needs progress past 1 to be revealed. */
const TOP = 0.999;

/** Pixels per lattice cell of the dissolve's clumping noise. */
const CLUMP = 5;

const DISSOLVE_SEED = 0x7a11;

function clamp(value: number): number {
  return Math.min(Math.max(value, 0), TOP);
}

/**
 * The progress at which a screen pixel switches to the incoming backdrop.
 *
 * `x`, `y` are screen pixels and `width`, `height` the screen's, so the same
 * pixel answers the same on every surface that asks.
 */
export function revealThreshold(style: TransitionStyle, x: number, y: number, width: number, height: number): number {
  const dither = ditherThreshold(x, y);
  switch (style) {
    case "dissolve":
      return clamp(0.72 * valueNoise2(x / CLUMP, y / CLUMP, DISSOLVE_SEED) + 0.28 * dither);
    case "iris": {
      const dx = (x - width / 2) / (width / 2);
      const dy = (y - height / 2) / (height / 2);
      return clamp((Math.hypot(dx, dy) / Math.SQRT2) * 0.9 + dither * 0.1);
    }
    case "flood":
      return clamp((1 - y / height) * 0.88 + Math.sin(x / 7) * 0.03 + 0.03 + dither * 0.06);
    case "descend":
      return clamp((y / height) * 0.88 + Math.sin(x / 9) * 0.03 + 0.03 + dither * 0.06);
  }
}

/** Every screen pixel's threshold for one style, row-major - computed once per style and size. */
export function revealField(style: TransitionStyle, width: number, height: number): Float32Array {
  const key = `${style}|${width}|${height}`;
  let field = FIELDS.get(key);
  if (field === undefined) {
    field = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        field[y * width + x] = revealThreshold(style, x, y, width, height);
      }
    }
    FIELDS.set(key, field);
  }
  return field;
}

const FIELDS = new Map<string, Float32Array>();

/** Whether a screen pixel shows the incoming backdrop at this progress. */
export function revealed(style: TransitionStyle, x: number, y: number, width: number, height: number, progress: number): boolean {
  return revealThreshold(style, x, y, width, height) < progress;
}

/** Where a surface sits on the screen, and the screen it sits on - what a mask is measured in. */
export interface MaskView {
  readonly style: TransitionStyle;
  readonly progress: number;
  /** Screen position of the surface's top-left pixel. */
  readonly originX: number;
  readonly originY: number;
  readonly screenWidth: number;
  readonly screenHeight: number;
}

/**
 * Mix two pictures of the same size into `out` by the mask: the incoming one
 * where a pixel has been revealed, the outgoing one elsewhere. Either may be
 * `undefined`, which is transparent there - how a backdrop drawn by other
 * layers (the live sky) shows through. Off-screen pixels count as unrevealed
 * below progress 1 and revealed at it.
 */
export function composeMasked(
  out: PixelBuffer,
  from: PixelBuffer | undefined,
  to: PixelBuffer | undefined,
  view: MaskView,
): void {
  const field = revealField(view.style, view.screenWidth, view.screenHeight);
  const data = out.data;
  data.fill(0);
  for (let y = 0; y < out.height; y += 1) {
    const sy = view.originY + y;
    for (let x = 0; x < out.width; x += 1) {
      const sx = view.originX + x;
      const onScreen = sx >= 0 && sy >= 0 && sx < view.screenWidth && sy < view.screenHeight;
      const threshold = onScreen ? (field[sy * view.screenWidth + sx] ?? TOP) : TOP;
      const source = threshold < view.progress ? to : from;
      if (source !== undefined) {
        copyPixel(data, source.data, (y * out.width + x) * 4);
      }
    }
  }
}

function copyPixel(into: Uint8ClampedArray, from: Uint8ClampedArray, offset: number): void {
  const alpha = (from[offset + 3] ?? 0) / 255;
  if (alpha > 0) {
    compositeOver(into, offset, from[offset] ?? 0, from[offset + 1] ?? 0, from[offset + 2] ?? 0, alpha);
  }
}
