/**
 * Shading: ordered ink ramps, dithering, and the light pass over a pixel cloud.
 *
 * The palette is closed, but it is not one bit deep. An ink is a *hue*, and a
 * **ramp** is an ordered walk of inks from shadow to highlight — so a lit
 * surface is not a new colour, it is a step of a ramp that already exists. That
 * is the whole trick that lets this art direction have shadows, rim light and
 * gradients without letting an agent invent `#7f8c9a` in the middle of a sprite.
 *
 * Shading here is **computed, never painted**. `shadeCloud` takes a cloud and a
 * light direction and re-inks every pixel from the ramp; the gradient between
 * two adjacent ramp steps is resolved with a 4x4 ordered (Bayer) dither locked
 * to the logical pixel grid, which is what keeps a gradient looking like pixel
 * art instead of like a resampled photograph. Everything in this module is a
 * pure function of its arguments, so the same cloud shades to the same pixels on
 * every run and in every test.
 *
 * This is the mechanism the "shadows and lighting" half of the art direction
 * compiles to. If you are about to hand-draw a shaded frame, you want this file.
 */

import { cloudBounds, type CloudBounds, type InkId, type InkPixel, type PixelCloud } from "./ink";

export type RampId = "bone" | "ember" | "arcane" | "verdant" | "tide";

/**
 * The ramps, darkest first. Every entry is an ink that already exists in
 * `INK_COLORS`: a ramp arranges the palette, it does not extend it.
 *
 * A ramp is allowed to end in `bone` — the near-white — because on pitch black
 * the highlight is what carries the silhouette. Starting one at `void` would
 * make the shadow side a hole rather than a dark surface; that is a deliberate
 * effect (see `cycleRamp` and the dissolve recipes), not the default.
 */
export const INK_RAMPS: Readonly<Record<RampId, readonly InkId[]>> = {
  bone: ["deep", "steel", "ice", "bone"],
  ember: ["deep", "ember", "amber", "bone"],
  arcane: ["deep", "violet", "magenta", "ice"],
  verdant: ["deep", "steel", "neon-green", "bone"],
  tide: ["deep", "steel", "cyan", "ice"],
};

/**
 * Normalised 4x4 Bayer thresholds in [0, 1).
 *
 * Indexed `[y % 4][x % 4]` in *logical* pixels, so the dither pattern is nailed
 * to the grid: it does not swim when a sprite moves, and it survives the integer
 * upscale as visible chunky texture rather than as noise.
 */
export const BAYER_4X4: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((value) => (value + 0.5) / 16));

/** The Bayer threshold for a logical pixel. Negative coordinates wrap correctly. */
export function ditherThreshold(x: number, y: number): number {
  const row = BAYER_4X4[((Math.round(y) % 4) + 4) % 4];
  return row?.[((Math.round(x) % 4) + 4) % 4] ?? 0.5;
}

/** NaN clamps to 0: a level nobody computed is unlit, never an ink off the end of the ramp. */
function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), 1);
}

/**
 * Pick a ramp step for a 0..1 level.
 *
 * With `dither` the fractional part between two steps is resolved against the
 * Bayer threshold at (x, y), which reads as a gradient; without it the level is
 * hard-quantised, which reads as banding and is what you want for a rune, a
 * shield or anything meant to look like flat cel shading.
 */
export function rampInk(
  ramp: readonly InkId[],
  level: number,
  dither?: { readonly x: number; readonly y: number },
): InkId {
  const steps = ramp.length;
  if (steps === 0) {
    throw new Error("A ramp needs at least one ink");
  }
  const scaled = clamp01(level) * (steps - 1);
  const base = Math.floor(scaled);
  const raised =
    dither !== undefined && scaled - base > ditherThreshold(dither.x, dither.y) ? base + 1 : base;
  const index = Math.min(Math.max(dither === undefined ? Math.round(scaled) : raised, 0), steps - 1);
  return ramp[index] as InkId;
}

/**
 * Rotate a ramp by `steps`, wrapping.
 *
 * This is palette cycling, the cheapest animation in the file: re-ink a static
 * cloud from `cycleRamp(ARCANE, tick)` and a rune appears to circulate without
 * a single new pixel being placed. Fractional or negative steps are fine.
 */
export function cycleRamp(ramp: readonly InkId[], steps: number): readonly InkId[] {
  const size = ramp.length;
  if (size === 0) {
    throw new Error("A ramp needs at least one ink");
  }
  const shift = ((Math.trunc(steps) % size) + size) % size;
  return [...ramp.slice(shift), ...ramp.slice(0, shift)];
}

export interface ShadeOptions {
  /** Darkest-first inks. Use one of `INK_RAMPS`, or an inline ramp for one asset. */
  readonly ramp: readonly InkId[];
  /**
   * Screen-space light direction: `+x` right, `+y` **down**, matching cloud
   * coordinates. Need not be normalised. Defaults to over-the-left-shoulder.
   */
  readonly light?: { readonly x: number; readonly y: number };
  /** Level floor on the unlit side, 0..1. Raise it to keep shadow detail readable. */
  readonly ambient?: number;
  /** Ordered dithering between ramp steps. Off gives flat cel bands. Default on. */
  readonly dither?: boolean;
  /** Re-ink only pixels currently in these inks — leaves eyes, gems and `void` alone. */
  readonly only?: readonly InkId[];
  /**
   * Replace the light field entirely: return 0..1 for a pixel. Use it for rim
   * light, height ramps, or a level sampled from a noise or flow field.
   */
  readonly levelAt?: (pixel: InkPixel, bounds: CloudBounds) => number;
}

const DEFAULT_LIGHT = { x: -0.6, y: -0.8 };

/**
 * Re-ink a cloud as if lit from one direction.
 *
 * The level field is the pixel's position projected onto the light direction,
 * normalised across the cloud's own bounds — so a model shades the same whether
 * it is 12 pixels tall or 40, and a clip's frames stay consistent with each
 * other because each is normalised the same way. An empty cloud comes back
 * empty, and a cloud with no extent along the light axis shades flat rather than
 * dividing by zero.
 */
export function shadeCloud(cloud: PixelCloud, options: ShadeOptions): PixelCloud {
  const bounds = cloudBounds(cloud);
  if (bounds === null) {
    return [];
  }

  const ambient = clamp01(options.ambient ?? 0.15);
  const dither = options.dither ?? true;
  const only = options.only === undefined ? null : new Set<InkId>(options.only);
  const level = options.levelAt ?? directionalLevel(options.light ?? DEFAULT_LIGHT, bounds);

  return cloud.map((pixel) => {
    if (only !== null && !only.has(pixel.ink)) {
      return pixel;
    }
    const lit = ambient + (1 - ambient) * clamp01(level(pixel, bounds));
    const ink = rampInk(options.ramp, lit, dither ? { x: pixel.x, y: pixel.y } : undefined);
    return { x: pixel.x, y: pixel.y, ink };
  });
}

/**
 * The default level field: 1 where the light strikes, 0 on the far side.
 *
 * Exported because a caller that wants to *combine* fields — directional light
 * plus a flickering torch, say — needs the base term rather than a re-derivation
 * of it.
 */
export function directionalLevel(
  light: { readonly x: number; readonly y: number },
  bounds: CloudBounds,
): (pixel: InkPixel) => number {
  const length = Math.hypot(light.x, light.y);
  const unitX = length === 0 ? 0 : light.x / length;
  const unitY = length === 0 ? 0 : light.y / length;

  // Extreme projections of the bounding box decide the normalisation window, so
  // the brightest and darkest ramp steps are both reached for any light angle.
  const projections = [
    unitX * bounds.left + unitY * bounds.top,
    unitX * bounds.right + unitY * bounds.top,
    unitX * bounds.left + unitY * bounds.bottom,
    unitX * bounds.right + unitY * bounds.bottom,
  ];
  const low = Math.min(...projections);
  const span = Math.max(...projections) - low;

  return (pixel) => {
    if (span === 0) {
      return 1;
    }
    return (unitX * pixel.x + unitY * pixel.y - low) / span;
  };
}
