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
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import { pixelHash } from "./transforms";
import { puddleBody } from "./water/body";
import { EDGE_GAIN, PUDDLE_SPREAD, traceOutline, type WaterOffset } from "./water/outline";
import { reflectionCloud } from "./water/reflect";
import { skyReflection, type SkyReflection } from "./water/sky-inks";

// The outline is traced in `water/outline.ts`; these are re-exported so a puddle's callers need one import.
export { outlineExtent, outlineHolds, PUDDLE_SPREAD, type WaterOffset } from "./water/outline";

export interface PuddleOptions {
  readonly id: string;
  /** Screen pixel the puddle is centred on. */
  readonly centerX: number;
  readonly centerY: number;
  /** Half-width in logical pixels; the depth half-axis is foreshortened from it. */
  readonly radius: number;
  readonly seed: number;
  /** How deep it is compared to how wide, in the world; `PUDDLE_SPREAD` if left out. */
  readonly spread?: number;
  /**
   * Half-width in logical pixels of a deep core - a disc on the ground, so a
   * foreshortened ellipse here - drawn darker; 0 or left out for water that is
   * shallow all the way across. A lake's is the water nothing can wade into.
   */
  readonly deep?: number;
  /**
   * Standing water rather than a rain puddle: its shallows show a pale shelf
   * instead of mud (`SkyReflection.shelf`), and its sky gradient is dithered
   * band into band, since a lake is tall enough for eight bands to read as stripes.
   */
  readonly lake?: boolean;
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
  /** Half-axes of the deep core, logical pixels; both 0 for shallow water. */
  readonly deepX: number;
  readonly deepY: number;
  /** A lake's water, not a puddle's: see `PuddleOptions.lake`. */
  readonly lake: boolean;
  /** Every water pixel, absolute, far row first. */
  readonly water: readonly ScreenPixel[];
  /** The subset of `water` on the outline. */
  readonly rim: readonly ScreenPixel[];
  /**
   * The same water about the centre, rim marked: the traced outline every
   * puddle of this shape shares, so a caller that places the pixels itself -
   * the mask, the body bake - allocates nothing per pixel.
   */
  readonly offsets: readonly WaterOffset[];
  /**
   * Whether an offset from the centre is water - what backs `puddleHolds`.
   * Read off the grid the outline was traced into, and shared by every puddle
   * of one outline, so a lake re-grown each step builds nothing of its own.
   */
  readonly inside: (dx: number, dy: number) => boolean;
}

export function createPuddle(options: PuddleOptions): Puddle {
  if (options.radius < 2) {
    throw new Error("A puddle needs a radius of at least 2");
  }

  const radiusX = Math.round(options.radius);
  const spread = options.spread ?? PUDDLE_SPREAD;
  const { centerX, centerY, seed } = options;
  const { radiusY, offsets, inside } = traceOutline(radiusX, seed, spread);
  // A disc on the ground: as wide as asked, foreshortened like a tile.
  const deepX = Math.max(0, Math.round(options.deep ?? 0));
  const deepY = Math.round((deepX * TILE_DEPTH) / TILE_WIDTH);

  // The pixels are laid out only when asked for: the field re-grows every lake
  // in reach each step, and most of what it does with one - membership, the
  // mask, a cached body - reads the shared outline instead (`offsets`).
  let water: ScreenPixel[] | undefined;
  let rim: ScreenPixel[] | undefined;
  const lay = (): void => {
    water = [];
    rim = [];
    for (const { dx, dy, edge } of offsets) {
      const pixel = { x: centerX + dx, y: centerY + dy };
      water.push(pixel);
      if (edge) {
        rim.push(pixel);
      }
    }
  };

  return {
    id: options.id,
    centerX,
    centerY,
    radiusX,
    radiusY,
    seed,
    deepX,
    deepY,
    lake: options.lake ?? false,
    get water(): readonly ScreenPixel[] {
      if (water === undefined) {
        lay();
      }
      return water ?? [];
    },
    get rim(): readonly ScreenPixel[] {
      if (rim === undefined) {
        lay();
      }
      return rim ?? [];
    },
    offsets,
    inside,
  };
}

export function puddleHolds(puddle: Puddle, x: number, y: number): boolean {
  return puddle.inside(Math.round(x) - Math.round(puddle.centerX), Math.round(y) - Math.round(puddle.centerY));
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

/**
 * How many highlights the sky lays on water this wide: three on a puddle, and
 * more as it widens, so a lake shimmers all over rather than in one corner.
 */
export function glintCount(radiusX: number): number {
  return Math.max(3, Math.min(10, Math.round(radiusX / 8)));
}

/** The longest one glint band is drawn, logical pixels: light on a lake breaks into short runs. */
const GLINT_MAX_LENGTH = 8;

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
  const count = glintCount(puddle.radiusX);
  // A lake's glints wander its whole width; a puddle's keep to its middle.
  const spread = count > 3 ? 0.6 : 0.35;

  for (let index = 0; index < count; index += 1) {
    const acrossUnit = pixelHash(index, 0, puddle.seed, 31) * 2 - 1;
    const reach = 0.35 + pixelHash(index, 2, puddle.seed, 33) * 0.45;
    const periodMs = 2600 + Math.floor(pixelHash(index, 3, puddle.seed, 34) * 2200);
    const sway = quantizedWave(elapsedMs, periodMs, 2, index);

    const longest = puddle.lake ? GLINT_MAX_LENGTH : Number.POSITIVE_INFINITY;
    const length = Math.max(2, Math.min(longest, Math.round(puddle.radiusX * reach)));
    const startX =
      puddle.centerX +
      Math.round(acrossUnit * puddle.radiusX * spread) -
      Math.floor(length / 2) +
      sway;
    // Kept to the far half and just past it: the back of the water is seen at
    // a grazing angle, and that is where the sky's light skips off it.
    // Evenly dealt, then nudged off the lattice on a lake, so many bands do not stack into a ladder.
    const jitter = count > 3 ? (pixelHash(index, 4, puddle.seed, 35) - 0.5) / count : 0;
    const downUnit = ((index + 0.5) / count + jitter) * 1.2 - 0.85;
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
