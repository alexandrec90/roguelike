/**
 * The still body of a puddle, in full colour: damp ground, a dark far lip, the
 * sky dithered across the water, and a shallow sheer edge at the front.
 *
 * Reading from the outside in:
 *
 * 1. **The wet ring** — the ground just outside the water, darkened with the
 *    sheer `shadow-soft` ink so the grass under it still shows. Solid for one
 *    pixel, dithered for the next: soaked, then damp. This is what seats the
 *    water *in* the field instead of on top of it.
 * 2. **The far lip** — the back edge of the water, where the bank the eye looks
 *    over is mirrored as a dark band. It is the cue that says "depression".
 * 3. **The sky** — the `SkyReflection` gradient from `sky-inks.ts`, horizon
 *    colour at the back, overhead colour at the front, Bayer-dithered between
 *    pairs of real inks.
 * 4. **The shallow edge** — the front rim in the legacy `water` ink, which is
 *    sheer by declaration: the eye looks steeply down into the water there and
 *    sees the mud through it.
 *
 * Static for a given sky, so a layer bakes it once per pose (and again when the
 * sky has visibly moved on) rather than every frame.
 */

import type { InkId, PixelCloud } from "../ink";
import { ditherThreshold } from "../shading";
import type { Puddle } from "../puddles";
import { pairInk, REFLECTION_BANDS, type SkyReflection } from "./sky-inks";

/** Damp ground around the water. Sheer, so it darkens the grass rather than hiding it. */
export const WET_INK: InkId = "shadow-soft";

/** The sheer front edge, where the water is shallow enough to see into. */
export const SHALLOW_INK: InkId = "water";

/** One number per pixel: a string key here was most of the cost of a body. */
function pixelKey(x: number, y: number): number {
  return (x + 0x8000) * 0x10000 + (y + 0x8000);
}

/** Membership over a puddle's pixels, for the neighbour tests below. */
function holder(puddle: Puddle): (x: number, y: number) => boolean {
  const keys = new Set(puddle.water.map((pixel) => pixelKey(pixel.x, pixel.y)));
  return (x, y) => keys.has(pixelKey(x, y));
}

/** One and two pixels out from the water, on every side. */
function wetRing(puddle: Puddle, holds: (x: number, y: number) => boolean): PixelCloud {
  const cloud: PixelCloud = [];
  const seen = new Set<number>();
  for (const pixel of puddle.rim) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = pixel.x + dx;
        const y = pixel.y + dy;
        const key = pixelKey(x, y);
        if (seen.has(key) || holds(x, y)) {
          continue;
        }
        const reach = Math.max(Math.abs(dx), Math.abs(dy));
        const near = reach === 1 && Math.abs(dx) + Math.abs(dy) === 1;
        // The far side's damp band is foreshortened like everything else on the
        // ground, so it only reaches one row up the screen.
        if (!near && (dy < -1 || ditherThreshold(x, y) > 0.4)) {
          continue;
        }
        seen.add(key);
        cloud.push({ x, y, ink: WET_INK });
      }
    }
  }
  return cloud;
}

/**
 * Bodies already painted, about their centres, per sky. A body is a function of
 * the puddle's outline, the sky, and where its centre falls on the 4x4 dither -
 * not of where it lies - and a step moves every puddle by a whole number of
 * dither cells (twelve pixels forward, sixteen across), so the field and the
 * horizon lip re-grow the same bodies step after step.
 */
const BODIES = new WeakMap<SkyReflection, Map<string, PixelCloud>>();
const BODY_LIMIT = 256;

/**
 * The whole still surface, absolute screen pixels, wet ring first so the water
 * paints over it.
 */
export function puddleBody(puddle: Puddle, sky: SkyReflection): PixelCloud {
  const { centerX, centerY } = puddle;
  if (!Number.isInteger(centerX) || !Number.isInteger(centerY)) {
    return paintBody(puddle, sky);
  }
  return relativeBody(puddle, sky).map((pixel) => ({ ...pixel, x: pixel.x + centerX, y: pixel.y + centerY }));
}

/**
 * `puddleBody` about the puddle's centre rather than on the screen - shared and
 * kept, so a caller that places it itself copies nothing. The centre must be a
 * whole pixel, as every grown puddle's is.
 */
export function relativeBody(puddle: Puddle, sky: SkyReflection): PixelCloud {
  const { centerX, centerY } = puddle;
  let bodies = BODIES.get(sky);
  if (bodies === undefined) {
    bodies = new Map();
    BODIES.set(sky, bodies);
  }
  const key = `${puddle.radiusX}:${puddle.seed}:${centerX & 3}:${centerY & 3}:${puddle.water.length}`;
  let relative = bodies.get(key);
  if (relative === undefined) {
    relative = paintBody(puddle, sky).map((pixel) => ({ ...pixel, x: pixel.x - centerX, y: pixel.y - centerY }));
    if (bodies.size >= BODY_LIMIT) {
      bodies.clear();
    }
    bodies.set(key, relative);
  }
  return relative;
}

function paintBody(puddle: Puddle, sky: SkyReflection): PixelCloud {
  const holds = holder(puddle);
  const cloud = wetRing(puddle, holds);
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const pixel of puddle.water) {
    top = Math.min(top, pixel.y);
    bottom = Math.max(bottom, pixel.y);
  }
  const depth = Math.max(bottom - top, 1);

  for (const { x, y } of puddle.water) {
    const band = Math.round(((y - top) / depth) * (REFLECTION_BANDS - 1));
    const pair = sky.rows[band] ?? sky.rows[0];
    let ink: InkId = pair === undefined ? SHALLOW_INK : pairInk(pair, x, y);
    const farSide = y < puddle.centerY;
    if (!holds(x, y - 1) && farSide) {
      ink = sky.lip;
    } else if (!holds(x, y - 2) && farSide && ditherThreshold(x, y) < 0.5) {
      ink = sky.lip;
    } else if (!holds(x, y + 1) || (!farSide && (!holds(x - 1, y) || !holds(x + 1, y)))) {
      ink = SHALLOW_INK;
    }
    cloud.push({ x, y, ink });
  }
  return cloud;
}
