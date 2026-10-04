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
 *    pairs of real inks: over mud in a puddle, over a pale shelf in a lake's
 *    shallows, and darker over a lake's deep core.
 * 4. **The shallow edge** — the front rim in the legacy `water` ink, which is
 *    sheer by declaration: the eye looks steeply down into the water there and
 *    sees the mud through it.
 *
 * Static for a given sky, so a layer bakes it once per pose (and again when the
 * sky has visibly moved on) rather than every frame. How a body is worked out
 * is `body-plan.ts`; this file is the two caches over it - plans per outline,
 * inked bodies per sky and dither phase.
 */

import type { PixelCloud } from "../ink";
import type { Puddle } from "../puddles";
import { inkPlan, planBody, type BodyPlan } from "./body-plan";
import { reflectionKey, type SkyReflection } from "./sky-inks";

export { deepShare, SHALLOW_INK, WET_INK } from "./body-plan";

/**
 * Bodies already painted, about their centres, per sky. A body is a function of
 * the puddle's outline, the sky, and where its centre falls on the 4x4 dither -
 * not of where it lies - and a step moves every puddle by a whole number of
 * dither cells (twelve pixels forward, sixteen across), so the field and the
 * horizon lip re-grow the same bodies step after step.
 */
const BODIES = new Map<string, Map<string, PixelCloud>>();

/**
 * Keyed by what the sky *paints* (`reflectionKey`), not by the sky object: a
 * new object is made every twentieth of an hour as the light moves on, and
 * keying by it threw every body away that often - the lip's few dozen at once,
 * a 14 ms frame - while the water looked no different.
 */
const SKY_KEYS = new WeakMap<SkyReflection, string>();
const SKY_LIMIT = 4;

function bodiesFor(sky: SkyReflection): Map<string, PixelCloud> {
  let key = SKY_KEYS.get(sky);
  if (key === undefined) {
    key = reflectionKey(sky);
    SKY_KEYS.set(sky, key);
  }
  let bodies = BODIES.get(key);
  if (bodies === undefined) {
    if (BODIES.size >= SKY_LIMIT) {
      const oldest = BODIES.keys().next();
      if (oldest.done !== true) {
        BODIES.delete(oldest.value);
      }
    }
    bodies = new Map();
    BODIES.set(key, bodies);
  }
  return bodies;
}

/**
 * Bodies kept per sky, and how many go when it is full - the oldest. A puddle
 * has up to sixteen bodies, one per dither phase of its centre, and a walk that
 * turns the world visits most of them: the lip's few dozen puddles overran a
 * cache of 256 that was emptied whole when full, so every crossing re-painted
 * them all.
 */
const BODY_LIMIT = 1024;
const BODY_EVICT = 256;

/**
 * Plans kept, one per outline whatever its phase or sky; the oldest go first,
 * and one asked for again is the newest. The lip churns through hundreds of
 * puddle outlines a walk, and a lake's plan must not be the price of that.
 */
const PLANS = new Map<string, BodyPlan>();
const PLAN_LIMIT = 1024;

/** What a body is without its sky or its dither phase: an outline, a core, a kind of water. */
function outlineKey(puddle: Puddle): string {
  return `${puddle.radiusX}:${puddle.seed}:${puddle.offsets.length}:${puddle.deepX}:${puddle.lake ? 1 : 0}`;
}

/** The plan for a puddle's outline, worked out once (`body-plan.ts`). */
export function bodyPlan(puddle: Puddle): BodyPlan {
  const key = outlineKey(puddle);
  let plan = PLANS.get(key);
  if (plan === undefined) {
    plan = planBody(puddle);
    if (PLANS.size >= PLAN_LIMIT) {
      const oldest = PLANS.keys().next();
      if (oldest.done !== true) {
        PLANS.delete(oldest.value);
      }
    }
  } else {
    PLANS.delete(key);
  }
  PLANS.set(key, plan);
  return plan;
}

/**
 * The whole still surface, absolute screen pixels, wet ring first so the water
 * paints over it.
 */
export function puddleBody(puddle: Puddle, sky: SkyReflection): PixelCloud {
  const { centerX, centerY } = puddle;
  const relative =
    Number.isInteger(centerX) && Number.isInteger(centerY)
      ? relativeBody(puddle, sky)
      : inkPlan(bodyPlan(puddle), sky, centerX, centerY);
  return relative.map((pixel) => ({ ...pixel, x: pixel.x + centerX, y: pixel.y + centerY }));
}

/**
 * `puddleBody` about the puddle's centre rather than on the screen - shared and
 * kept, so a caller that places it itself copies nothing. The centre must be a
 * whole pixel, as every grown puddle's is.
 *
 * `dither` is where on the screen's 4x4 dither the centre is taken to land - its
 * own centre unless given. The horizon lip passes a fixed one for water wholly
 * past the seam, where texels are resampled and no phase can be seen: a lake
 * out there slid onto a new phase every step the world turned, and each one
 * was a re-inking.
 */
export function relativeBody(
  puddle: Puddle,
  sky: SkyReflection,
  dither: { readonly x: number; readonly y: number } = { x: puddle.centerX, y: puddle.centerY },
): PixelCloud {
  const bodies = bodiesFor(sky);
  const key = `${outlineKey(puddle)}:${dither.x & 3}:${dither.y & 3}`;
  let relative = bodies.get(key);
  if (relative === undefined) {
    relative = inkPlan(bodyPlan(puddle), sky, dither.x, dither.y);
    if (bodies.size >= BODY_LIMIT) {
      const oldest = [...bodies.keys()].slice(0, BODY_EVICT);
      for (const stale of oldest) {
        bodies.delete(stale);
      }
    }
    bodies.set(key, relative);
  }
  return relative;
}
