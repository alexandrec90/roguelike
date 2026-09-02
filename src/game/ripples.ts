/**
 * Rings on water: the pool that holds them, the clock that ages them, and the
 * ellipse outline one draws at a given age.
 *
 * This is deliberately ignorant of puddles. A ring is a mark spreading from a
 * point — it does not know what it is spreading across, and the clipping to
 * water happens where both halves are already in hand (`water-layer.ts`). That
 * keeps the geometry here testable against nothing but its own age, and it is
 * why `rippleCloud` happily returns pixels outside any puddle.
 *
 * `puddles.ts` owns the water itself and `rainImpact` — where a falling drop
 * goes in. This file owns what happens after.
 */

import type { InkId, PixelCloud } from "./ink";
import { cloudToSprite, type CloudFrame } from "./ink";
import type { PixelSpriteSource } from "./pixel-art";
import { DEPTH_RATIO } from "./projection";

/**
 * How long one ring lasts.
 *
 * This is a density knob as much as a timing one. The sample field takes about
 * three and a half drops a second across all its water (`field.test.ts` measures
 * it), so the number of rings on screen at any moment is that rate times this
 * life — at 640 ms the storm averaged two, which is close enough to none that
 * the water read as still.
 */
export const RIPPLE_LIFE_MS = 900;

/** How wide a ring gets before it dies, in logical pixels. */
export const RIPPLE_MAX_RADIUS = 6;

export interface Ripple {
  active: boolean;
  x: number;
  y: number;
  ageMs: number;
  lifeMs: number;
}

export interface RippleField {
  readonly ripples: Ripple[];
}

/** Same offset-into-one-number trick `puddles.ts` uses for its surface set. */
const KEY_SPAN = 4096;

function ringKey(x: number, y: number): number {
  return (x + KEY_SPAN) * KEY_SPAN * 2 + (y + KEY_SPAN);
}

/**
 * A fixed pool, for the same reason the spark emitter has one: a storm that
 * ran all night must not have grown its ring count. A spawn with no free slot
 * is dropped, which is the cap doing its job rather than a failure.
 */
export function createRippleField(capacity = 28): RippleField {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error("Ripple capacity must be a positive integer");
  }
  return {
    ripples: Array.from({ length: capacity }, () => ({
      active: false,
      x: 0,
      y: 0,
      ageMs: 0,
      lifeMs: 0,
    })),
  };
}

/** True when a slot was free and the ring started. */
export function spawnRipple(
  field: RippleField,
  x: number,
  y: number,
  lifeMs: number = RIPPLE_LIFE_MS,
): boolean {
  const slot = field.ripples.find((ripple) => !ripple.active);
  if (slot === undefined) {
    return false;
  }
  slot.active = true;
  slot.x = Math.round(x);
  slot.y = Math.round(y);
  slot.ageMs = 0;
  slot.lifeMs = lifeMs;
  return true;
}

export function stepRipples(field: RippleField, deltaMs: number): void {
  const delta = Math.max(deltaMs, 0);
  for (const ripple of field.ripples) {
    if (!ripple.active) {
      continue;
    }
    ripple.ageMs += delta;
    if (ripple.ageMs >= ripple.lifeMs) {
      ripple.active = false;
    }
  }
}

export function resetRipples(field: RippleField): void {
  for (const ripple of field.ripples) {
    ripple.active = false;
    ripple.x = 0;
    ripple.y = 0;
    ripple.ageMs = 0;
    ripple.lifeMs = 0;
  }
}

function rippleProgress(ripple: Ripple): number {
  if (!ripple.active || ripple.lifeMs <= 0) {
    return 1;
  }
  return Math.min(Math.max(ripple.ageMs / ripple.lifeMs, 0), 1);
}

/** Fades as the ring spreads, so the scene never draws a hard-edged old ring. */
export function rippleAlpha(ripple: Ripple): number {
  if (!ripple.active) {
    return 0;
  }
  return 1 - rippleProgress(ripple);
}

/**
 * One ring at its current age: a foreshortened ellipse outline, plus the
 * splash pixel at the centre for as long as the drop is still going in.
 *
 * The ring opens fast and slows, which is what a real impact does and what
 * stops a linear ring reading as a growing circle drawn by a machine.
 */
export function rippleCloud(ripple: Ripple, ink: InkId = "ice"): PixelCloud {
  if (!ripple.active) {
    return [];
  }
  const progress = rippleProgress(ripple);
  const eased = 1 - (1 - progress) ** 2;
  const radiusX = Math.round(1 + eased * (RIPPLE_MAX_RADIUS - 1));
  const radiusY = Math.max(1, Math.round(radiusX * DEPTH_RATIO));

  const cloud: PixelCloud = [];
  const seen = new Set<number>();
  const put = (dx: number, dy: number, pixelInk: InkId): void => {
    const key = ringKey(dx, dy);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    cloud.push({ x: ripple.x + dx, y: ripple.y + dy, ink: pixelInk });
  };

  // Swept twice — once per axis — because a single sweep leaves gaps wherever
  // the outline runs steeper than one pixel per step.
  for (let dx = -radiusX; dx <= radiusX; dx += 1) {
    const dy = Math.round(radiusY * Math.sqrt(Math.max(0, 1 - (dx / radiusX) ** 2)));
    put(dx, dy, ink);
    put(dx, -dy, ink);
  }
  for (let dy = -radiusY; dy <= radiusY; dy += 1) {
    const dx = Math.round(radiusX * Math.sqrt(Math.max(0, 1 - (dy / radiusY) ** 2)));
    put(dx, dy, ink);
    put(-dx, dy, ink);
  }
  if (progress < 0.25) {
    put(0, 0, "bone");
  }

  return cloud;
}

/** The lab frame a ring is baked into, the way `rig-frames.ts` bakes a clip. */
export const RIPPLE_FRAME: CloudFrame = { width: 18, height: 16, originX: 9, originY: 8 };

/** One ring's whole life, evenly sampled. */
export function sampleRippleFrames(count: number): PixelSpriteSource[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Frame count must be a positive integer");
  }
  return Array.from({ length: count }, (_unused, index) => {
    const ripple: Ripple = {
      active: true,
      x: 0,
      y: 0,
      ageMs: (index / count) * RIPPLE_LIFE_MS,
      lifeMs: RIPPLE_LIFE_MS,
    };
    return cloudToSprite(rippleCloud(ripple), RIPPLE_FRAME);
  });
}
