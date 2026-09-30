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
 * - `puddleSurface` — the body, its lip and the wet ground round it; static
 *   for a given sky.
 * - `puddleGlints` — the sky's shimmer sliding across it.
 * - `puddleReflection` — whatever stands over it, given back in its own inks.
 * - `rainImpact` — where a falling drop goes in, given the segment it fell down.
 *
 * Most of the body is the sky, mirrored in real inks (`water/sky-inks.ts`); the
 * shallow front edge is the legacy `water` ink, which is translucent by
 * declaration (`INK_ALPHA`), and the damp ground round it is the sheer
 * `shadow-soft`. That is the whole difference between a puddle and a hole cut
 * in the grass, and it is why this module never picks an alpha of its own.
 *
 * What happens *after* the drop lands is `ripples.ts`: a ring knows its own age
 * and nothing about water, so the two halves are separate files.
 */

import type { InkId, PixelCloud } from "./ink";
import { cloudToSprite, type CloudFrame } from "./ink";
import type { PixelSpriteSource } from "./pixel-art";
import { quantizedWave } from "./pixel-art";
import { atmosphereAt } from "./atmosphere";
import { DEPTH_RATIO } from "./projection";
import { pixelHash } from "./transforms";
import { puddleBody } from "./water/body";
import { reflectionCloud } from "./water/reflect";
import { skyReflection, type SkyReflection } from "./water/sky-inks";

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

/** What an unlit lab puddle mirrors: a clear noon. */
const NOON_SKY = skyReflection(atmosphereAt(13));

/**
 * The still surface, in full colour: damp ground around it, a dark far lip,
 * the sky mirrored across it, and a sheer shallow edge at the front — see
 * `water/body.ts`, which owns the recipe.
 *
 * `sky` is what the water mirrors (`skyReflection(atmosphere)`); left out, it
 * is a clear noon. Static for a given sky, so a scene stamps it once per pose.
 */
export function puddleSurface(puddle: Puddle, sky: SkyReflection = NOON_SKY): PixelCloud {
  return puddleBody(puddle, sky);
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
export function puddleGlints(puddle: Puddle, elapsedMs: number, ink: InkId = "ice"): PixelCloud {
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
    // Kept to the far half and just past it: the back of the water is seen at
    // a grazing angle, and that is where the sky's light skips off it.
    const downUnit = ((index + 0.5) / GLINT_COUNT) * 1.2 - 0.85;
    const y = puddle.centerY + Math.round(downUnit * puddle.radiusY * 0.8);
    // A shimmer rather than a bar: the band breathes a pixel shorter and longer.
    const breathe = quantizedWave(elapsedMs, periodMs * 0.37, 1, index * 2.1);
    for (let step = Math.max(0, -breathe); step < length + Math.min(breathe, 0) + 1; step += 1) {
      cloud.push({ x: startX + step, y, ink });
    }
  }

  return clipToPuddle(puddle, cloud);
}

/**
 * What the water gives back of something standing over this puddle.
 *
 * `water/reflect.ts` does the work — flipped, a little squashed, stepped two
 * places darker down each ink's own ramp, rippled row against row and faded
 * with depth — and this clips it to the one puddle. `originX`/`originY` are
 * where the reflected thing's feet are, the anchor the model was drawn at.
 */
export function puddleReflection(
  puddle: Puddle,
  cloud: PixelCloud,
  originX: number,
  originY: number,
  elapsedMs: number,
  rain = 0,
): PixelCloud {
  return clipToPuddle(puddle, reflectionCloud(cloud, originX, originY, elapsedMs, { rain }));
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

/**
 * Baking water into the fixed frame lists the asset registry speaks, the way
 * `rig-frames.ts` bakes clips: the lab must not be able to tell generated art
 * from drawn art.
 */
export const PUDDLE_FRAME: CloudFrame = { width: 44, height: 28, originX: 22, originY: 14 };

/** A lab-sized puddle, sampled across one full sweep of its slowest glint. */
export function samplePuddleFrames(
  count: number,
  seed = 0x9a7e,
  sky: SkyReflection = NOON_SKY,
): PixelSpriteSource[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Frame count must be a positive integer");
  }
  const puddle = createPuddle({ id: "lab-puddle", centerX: 0, centerY: 0, radius: 13, seed });
  const surface = puddleSurface(puddle, sky);
  return Array.from({ length: count }, (_unused, index) => {
    const elapsedMs = (index / count) * 4800;
    return cloudToSprite([...surface, ...puddleGlints(puddle, elapsedMs, sky.glint)], PUDDLE_FRAME);
  });
}
