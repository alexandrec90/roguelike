/**
 * Water: the puddles the field is dotted with, and everything that happens on
 * their surface.
 *
 * A puddle is not drawn. It is **generated** from a centre, a radius and a
 * seed — a foreshortened ellipse with a couple of seeded lobes pushed into its
 * outline — because the alternative is a mask per puddle, which is rung seven
 * of the art ladder for something the field wants a dozen of. One seed is one
 * puddle, and a new one costs a line of data rather than a drawing.
 *
 * Everything the water shows flattens to a `PixelCloud` in absolute screen
 * pixels, so the scene's only job is to draw it:
 *
 * - `puddleSurface` — the body and its rim, still and static.
 * - `puddleGlints` — the sky's shimmer sliding across it.
 * - `puddleReflection` — whatever stands over it, given back in its own inks.
 * - `rippleCloud` — the rings the rain punches into it.
 *
 * The body is `water` ink, which is translucent by declaration (`INK_ALPHA`),
 * so the ground reads faintly through it. That is the whole difference between
 * a puddle and a hole cut in the grass, and it is why this module never picks
 * an alpha of its own.
 */

import type { InkId, PixelCloud } from "./ink";
import { cloudToSprite, type CloudFrame } from "./ink";
import type { PixelSpriteSource } from "./pixel-art";
import { quantizedWave } from "./pixel-art";
import { DEPTH_RATIO } from "./projection";
import { pixelHash, reflectCloud } from "./transforms";

export interface PuddleOptions {
  readonly id: string;
  /** Screen pixel the puddle is centred on. */
  readonly centerX: number;
  readonly centerY: number;
  /** Half-width in logical pixels; the depth half-axis is foreshortened from it. */
  readonly radius: number;
  readonly seed: number;
}

export interface ScreenPixel {
  readonly x: number;
  readonly y: number;
}

export interface Puddle {
  readonly id: string;
  readonly centerX: number;
  readonly centerY: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly seed: number;
  /** Every water pixel, absolute, far row first. */
  readonly water: readonly ScreenPixel[];
  /** The subset of `water` on the outline. */
  readonly rim: readonly ScreenPixel[];
  /** Membership keys backing `puddleHolds`; see `surfaceKey`. */
  readonly keys: ReadonlySet<number>;
}

/**
 * Screen y is never more than a few hundred, so one key per pixel packs into a
 * single number and the membership test costs no string building in the render
 * loop.
 */
const KEY_SPAN = 4096;

function surfaceKey(x: number, y: number): number {
  return Math.round(x) * KEY_SPAN + Math.round(y);
}

/** Widest the seeded lobes can push the outline past the base ellipse. */
const EDGE_GAIN = 1.3;

/**
 * How deep a puddle is compared to how wide it is, **in the world** — before
 * the camera foreshortens it.
 *
 * Water spreads to the shallowest ground it can find, so a puddle is a broad
 * lens rather than a disc, and this is the difference between reading as water
 * lying on a field and reading as a rock seen from above. It is a separate
 * number from `DEPTH_RATIO` on purpose: that one is the camera and is not the
 * water's business to have an opinion about.
 */
const PUDDLE_SPREAD = 0.8;

/**
 * The outline's radius at one angle, as a multiple of the base ellipse.
 *
 * Two seeded harmonics, both periodic in theta, so the boundary closes on
 * itself instead of showing a seam where the angle wraps.
 */
function edgeScale(theta: number, seed: number): number {
  const phaseTwo = pixelHash(1, 0, seed, 21) * Math.PI * 2;
  const phaseThree = pixelHash(2, 0, seed, 22) * Math.PI * 2;
  return 1 + 0.17 * Math.sin(theta * 2 + phaseTwo) + 0.1 * Math.sin(theta * 3 + phaseThree);
}

export function createPuddle(options: PuddleOptions): Puddle {
  if (options.radius < 2) {
    throw new Error("A puddle needs a radius of at least 2");
  }

  const radiusX = Math.round(options.radius);
  // Lying on the ground, so authored already foreshortened by the camera pitch
  // — never drawn round and squashed at draw time. The spread is the puddle's
  // own shape; the ratio is the camera's.
  const radiusY = Math.max(1, Math.round(radiusX * PUDDLE_SPREAD * DEPTH_RATIO));

  const inside = (dx: number, dy: number): boolean => {
    const u = dx / radiusX;
    const v = dy / radiusY;
    const distance = Math.hypot(u, v);
    if (distance === 0) {
      return true;
    }
    return distance <= edgeScale(Math.atan2(v, u), options.seed);
  };

  const water: ScreenPixel[] = [];
  const rim: ScreenPixel[] = [];
  const keys = new Set<number>();
  const spanX = Math.ceil(radiusX * EDGE_GAIN);
  const spanY = Math.ceil(radiusY * EDGE_GAIN);

  for (let dy = -spanY; dy <= spanY; dy += 1) {
    for (let dx = -spanX; dx <= spanX; dx += 1) {
      if (!inside(dx, dy)) {
        continue;
      }
      const pixel = { x: options.centerX + dx, y: options.centerY + dy };
      water.push(pixel);
      keys.add(surfaceKey(pixel.x, pixel.y));
      const edge =
        !inside(dx - 1, dy) || !inside(dx + 1, dy) || !inside(dx, dy - 1) || !inside(dx, dy + 1);
      if (edge) {
        rim.push(pixel);
      }
    }
  }

  return {
    id: options.id,
    centerX: options.centerX,
    centerY: options.centerY,
    radiusX,
    radiusY,
    seed: options.seed,
    water,
    rim,
    keys,
  };
}

export function puddleHolds(puddle: Puddle, x: number, y: number): boolean {
  return puddle.keys.has(surfaceKey(x, y));
}

/** Drop everything that is not over water — the clip every water layer needs. */
export function clipToPuddle(puddle: Puddle, cloud: PixelCloud): PixelCloud {
  return cloud.filter((pixel) => puddleHolds(puddle, pixel.x, pixel.y));
}

/**
 * The still surface: a translucent body, a dim rim, and a brighter lip along
 * the far edge where the sky's light lands.
 *
 * Static, so a scene draws this once rather than every frame.
 */
export function puddleSurface(puddle: Puddle): PixelCloud {
  const cloud: PixelCloud = puddle.water.map((pixel) => ({
    x: pixel.x,
    y: pixel.y,
    ink: "water" as InkId,
  }));

  const lipY = puddle.centerY - puddle.radiusY * 0.45;
  for (const pixel of puddle.rim) {
    cloud.push({ x: pixel.x, y: pixel.y, ink: pixel.y <= lipY ? "steel" : "deep" });
  }
  return cloud;
}

/** How many highlights the sky lays on one puddle. */
const GLINT_COUNT = 3;

/**
 * The sky's shimmer: long horizontal bands sliding sideways at seeded rates.
 *
 * Bands rather than dots, because light on a surface lies *along* it — and
 * because a few short marks scattered on an oval stop being highlights and
 * start being a face. Their rows are dealt out evenly down the water rather
 * than seeded, for the same reason: three bands that happen to land together
 * read as one stripe, and no seed is worth that.
 *
 * A pure function of (puddle, time), so two captures of the same instant match
 * and the water still never holds still.
 */
export function puddleGlints(puddle: Puddle, elapsedMs: number): PixelCloud {
  const cloud: PixelCloud = [];

  for (let index = 0; index < GLINT_COUNT; index += 1) {
    const acrossUnit = pixelHash(index, 0, puddle.seed, 31) * 2 - 1;
    const reach = 0.35 + pixelHash(index, 2, puddle.seed, 33) * 0.45;
    const periodMs = 2600 + Math.floor(pixelHash(index, 3, puddle.seed, 34) * 2200);
    const sway = quantizedWave(elapsedMs, periodMs, 2, index);

    const length = Math.max(2, Math.round(puddle.radiusX * reach));
    const startX =
      puddle.centerX +
      Math.round(acrossUnit * puddle.radiusX * 0.35) -
      Math.floor(length / 2) +
      sway;
    const downUnit = ((index + 0.5) / GLINT_COUNT) * 2 - 1;
    const y = puddle.centerY + Math.round(downUnit * puddle.radiusY * 0.7);
    for (let step = 0; step < length; step += 1) {
      cloud.push({ x: startX + step, y, ink: "ice" });
    }
  }

  return clipToPuddle(puddle, cloud);
}

/**
 * What the water gives back.
 *
 * `reflectCloud` does the flip; this adds the two things that make it read as
 * water rather than as a shadow — a per-row sideways wobble, and the source
 * inks kept rather than flattened to one tone, so a neon mark reflects in its
 * own colour. The scene draws the result at a reduced alpha; how sheer the
 * reflection is belongs to the scene's lighting, not to the geometry.
 *
 * `originX`/`originY` are where the reflected thing's feet are — the same
 * anchor the model itself was drawn at.
 */
export function puddleReflection(
  puddle: Puddle,
  cloud: PixelCloud,
  originX: number,
  originY: number,
  elapsedMs: number,
): PixelCloud {
  const reflected = reflectCloud(cloud, { ink: null });
  const wobbled: PixelCloud = reflected.map((pixel) => ({
    x: originX + pixel.x + quantizedWave(elapsedMs + pixel.y * 90, 1700, 1),
    y: originY + pixel.y,
    ink: pixel.ink,
  }));
  return clipToPuddle(puddle, wobbled);
}

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

/** Where a falling drop went into the water, and which puddle took it. */
export interface RainImpact {
  readonly puddle: Puddle;
  readonly x: number;
  readonly y: number;
}

/**
 * The point at which a drop that travelled `from` → `to` this step went into
 * water, or null if it crossed none.
 *
 * Two things this deliberately is not. It is not a test of the drop's current
 * pixel: at `RAIN_FALL_SPEED` a drop covers several pixels a frame and would
 * step clean over a puddle's near edge. And it is not the first water pixel the
 * segment touches either — that pixel is always on the puddle's *far* rim,
 * because the segment comes down the screen, so every ring would open on the
 * back edge with most of itself outside the water and clipped away. That was
 * the bug this function exists to have fixed: rings were being drawn, and
 * almost none of any of them survived the clip.
 *
 * The projection has thrown away the depth that would say where the drop really
 * lands, so the drop is given one: the chord it would cut through the puddle is
 * walked out, and it lands at a seeded fraction along it. Seeded from the entry
 * pixel, so the same storm lands in the same places on every replay.
 */
export function rainImpact(
  puddles: readonly Puddle[],
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): RainImpact | null {
  const spanX = toX - fromX;
  const spanY = toY - fromY;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(spanX), Math.abs(spanY))));

  for (let step = 0; step <= steps; step += 1) {
    const along = step / steps;
    const x = Math.round(fromX + spanX * along);
    const y = Math.round(fromY + spanY * along);
    const puddle = puddles.find((candidate) => puddleHolds(candidate, x, y));
    if (puddle !== undefined) {
      return landingPoint(puddle, x, y, spanX, spanY);
    }
  }
  return null;
}

/** Walk out the chord the drop would cut, and pick a seeded point along it. */
function landingPoint(
  puddle: Puddle,
  entryX: number,
  entryY: number,
  spanX: number,
  spanY: number,
): RainImpact {
  const length = Math.hypot(spanX, spanY);
  const stepX = length === 0 ? 0 : spanX / length;
  const stepY = length === 0 ? 1 : spanY / length;
  // Bounded by the puddle: no chord through it is longer than its own outline.
  const reach = Math.ceil((puddle.radiusX + puddle.radiusY) * 2 * EDGE_GAIN);

  let exitX = entryX;
  let exitY = entryY;
  for (let step = 1; step <= reach; step += 1) {
    const x = Math.round(entryX + stepX * step);
    const y = Math.round(entryY + stepY * step);
    if (!puddleHolds(puddle, x, y)) {
      break;
    }
    exitX = x;
    exitY = y;
  }

  const along = 0.25 + pixelHash(entryX, entryY, puddle.seed, 51) * 0.5;
  return {
    puddle,
    x: Math.round(entryX + (exitX - entryX) * along),
    y: Math.round(entryY + (exitY - entryY) * along),
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
    const key = surfaceKey(dx, dy);
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

/**
 * Baking water into the fixed frame lists the asset registry speaks, the way
 * `rig-frames.ts` bakes clips: the lab must not be able to tell generated art
 * from drawn art.
 */
export const PUDDLE_FRAME: CloudFrame = { width: 36, height: 24, originX: 18, originY: 12 };
export const RIPPLE_FRAME: CloudFrame = { width: 18, height: 16, originX: 9, originY: 8 };

/** A lab-sized puddle, sampled across one full sweep of its slowest glint. */
export function samplePuddleFrames(count: number, seed = 0x9a7e): PixelSpriteSource[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Frame count must be a positive integer");
  }
  const puddle = createPuddle({ id: "lab-puddle", centerX: 0, centerY: 0, radius: 13, seed });
  const surface = puddleSurface(puddle);
  return Array.from({ length: count }, (_unused, index) => {
    const elapsedMs = (index / count) * 4800;
    return cloudToSprite([...surface, ...puddleGlints(puddle, elapsedMs)], PUDDLE_FRAME);
  });
}

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
