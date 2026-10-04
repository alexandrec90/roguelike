/**
 * A water body in two halves: the **plan**, which is its outline worked out
 * once, and the **inking**, which puts it in one sky's colours at one dither
 * phase.
 *
 * The plan is everything about a body that does not depend on the sky or on
 * where its centre falls on the 4x4 dither: which pixels are damp ground, far
 * lip, sheer edge or open water; how far down the gradient each one sits; how
 * far into the deep core. It costs the outline's neighbour tests, and a lake has
 * fifteen thousand pixels, so it is made once per outline.
 *
 * The inking reads the screen's dither where each pixel lands - so the dither
 * stays nailed to the screen's grid - and picks an ink. A change of light, or
 * a lake on the horizon sliding onto a new dither phase as the world turns,
 * costs only this pass. When every one of those re-planned a lake, strafing
 * past one on the horizon cost a 60 ms frame.
 */

import type { InkId, PixelCloud } from "../ink";
import type { Puddle } from "../puddles";
import { ditherThreshold } from "../shading";
import { REFLECTION_BANDS, type SkyReflection } from "./sky-inks";

/** Damp ground around the water. Sheer, so it darkens the grass rather than hiding it. */
export const WET_INK: InkId = "shadow-soft";

/** The sheer front edge, where the water is shallow enough to see into. */
export const SHALLOW_INK: InkId = "water";

/**
 * Where the shelf drops away, as a share of the deep core's squared radius: a
 * band this wide inside its edge is dithered between shallow and deep, so the
 * drop-off reads as a slope rather than a painted line - and still sits where
 * the water stops being wadeable.
 */
const SHELF = 0.78;

/** What a planned pixel is. The `_DITHER` kinds are only what they say where the dither allows. */
const WET = 0;
const WET_DITHER = 1;
const LIP = 2;
const LIP_DITHER = 3;
const EDGE = 4;
const WATER = 5;

export interface BodyPlan {
  readonly lake: boolean;
  readonly dx: Int16Array;
  readonly dy: Int16Array;
  readonly kind: Uint8Array;
  /** What a `LIP_DITHER` pixel is where the dither says no lip: `EDGE` or `WATER`. */
  readonly fallback: Uint8Array;
  /** How far down the gradient, in bands, before dithering. */
  readonly along: Float32Array;
  /** How far into the deep core, squared; above 1 outside it. */
  readonly share: Float32Array;
}

/**
 * A puddle's outline about its centre on a byte grid, with a dry border two
 * pixels wide for the neighbour tests: 0 dry, 1 water, 2 damp if dithered,
 * 3 damp always. A hash set of a lake's pixels, built and then asked five
 * times a pixel, was most of a 25 ms bake.
 */
class OutlineGrid {
  readonly minY: number;
  readonly maxY: number;
  private readonly minX: number;
  private readonly width: number;
  private readonly cells: Uint8Array;

  constructor(puddle: Puddle) {
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    for (const { dx, dy } of puddle.offsets) {
      minX = Math.min(minX, dx);
      maxX = Math.max(maxX, dx);
      minY = Math.min(minY, dy);
      maxY = Math.max(maxY, dy);
    }
    this.minX = minX;
    this.minY = minY;
    this.maxY = maxY;
    this.width = maxX - minX + 5;
    this.cells = new Uint8Array(this.width * (maxY - minY + 5));
    for (const { dx, dy } of puddle.offsets) {
      this.cells[this.index(dx, dy)] = 1;
    }
  }

  /** The cell under an offset; every offset within two pixels of the water is on the grid. */
  private index(dx: number, dy: number): number {
    return (dy - this.minY + 2) * this.width + (dx - this.minX + 2);
  }

  holds(dx: number, dy: number): boolean {
    return this.cells[this.index(dx, dy)] === 1;
  }

  cell(dx: number, dy: number): number {
    return this.cells[this.index(dx, dy)] ?? 0;
  }

  mark(dx: number, dy: number, value: number): void {
    this.cells[this.index(dx, dy)] = value;
  }
}

/**
 * The damp ground one and two pixels out from the water. A pixel next to the
 * water on a side is always damp; the rest are damp where the dither allows,
 * and never more than a row up the screen - the far side's band is
 * foreshortened like everything else on the ground.
 */
function planWet(puddle: Puddle, grid: OutlineGrid): { readonly dx: number; readonly dy: number }[] {
  const order: { dx: number; dy: number }[] = [];
  for (const rim of puddle.offsets) {
    if (!rim.edge) {
      continue;
    }
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = rim.dx + dx;
        const y = rim.dy + dy;
        const was = grid.cell(x, y);
        if (was === 1 || was === 3) {
          continue;
        }
        const near = Math.abs(dx) + Math.abs(dy) === 1;
        const status = near ? 3 : dy >= -1 ? 2 : 0;
        if (status > was) {
          if (was === 0) {
            order.push({ dx: x, dy: y });
          }
          grid.mark(x, y, status);
        }
      }
    }
  }
  return order;
}

/** The body about its centre, wet ring first so the water paints over it. */
export function planBody(puddle: Puddle): BodyPlan {
  const grid = new OutlineGrid(puddle);
  const wet = planWet(puddle, grid);
  const count = wet.length + puddle.offsets.length;
  const plan: BodyPlan = {
    lake: puddle.lake,
    dx: new Int16Array(count),
    dy: new Int16Array(count),
    kind: new Uint8Array(count),
    fallback: new Uint8Array(count),
    along: new Float32Array(count),
    share: new Float32Array(count),
  };
  wet.forEach(({ dx, dy }, index) => {
    plan.dx[index] = dx;
    plan.dy[index] = dy;
    plan.kind[index] = grid.cell(dx, dy) === 3 ? WET : WET_DITHER;
  });
  const depth = Math.max(grid.maxY - grid.minY, 1);
  let index = wet.length;
  for (const { dx, dy } of puddle.offsets) {
    plan.dx[index] = dx;
    plan.dy[index] = dy;
    plan.along[index] = ((dy - grid.minY) / depth) * (REFLECTION_BANDS - 1);
    plan.share[index] = deepOffsetShare(puddle, dx, dy);
    const farSide = dy < 0;
    const rest = !grid.holds(dx, dy + 1) || (!farSide && (!grid.holds(dx - 1, dy) || !grid.holds(dx + 1, dy))) ? EDGE : WATER;
    if (farSide && !grid.holds(dx, dy - 1)) {
      plan.kind[index] = LIP;
    } else if (farSide && !grid.holds(dx, dy - 2)) {
      plan.kind[index] = LIP_DITHER;
      plan.fallback[index] = rest;
    } else {
      plan.kind[index] = rest;
    }
    index += 1;
  }
  return plan;
}

/**
 * How far into the deep core a pixel is: above 1 outside it, 0 at its centre;
 * `Infinity` for water with no deep core. Squared, like the ellipse test it is.
 */
export function deepShare(puddle: Puddle, x: number, y: number): number {
  return deepOffsetShare(puddle, x - puddle.centerX, y - puddle.centerY);
}

function deepOffsetShare(puddle: Puddle, dx: number, dy: number): number {
  if (puddle.deepX === 0 || puddle.deepY === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return (dx / puddle.deepX) ** 2 + (dy / puddle.deepY) ** 2;
}

/**
 * A plan in one sky's inks, for a centre that lands at (`originX`, `originY`) -
 * only its place on the 4x4 dither matters - about that centre.
 */
export function inkPlan(plan: BodyPlan, sky: SkyReflection, originX: number, originY: number): PixelCloud {
  const cloud: PixelCloud = [];
  for (let index = 0; index < plan.kind.length; index += 1) {
    const dx = plan.dx[index] ?? 0;
    const dy = plan.dy[index] ?? 0;
    const x = originX + dx;
    const y = originY + dy;
    const threshold = ditherThreshold(x, y);
    let kind = plan.kind[index] ?? WATER;
    if (kind === WET_DITHER) {
      if (threshold > 0.4) {
        continue;
      }
      kind = WET;
    } else if (kind === LIP_DITHER) {
      kind = threshold < 0.5 ? LIP : (plan.fallback[index] ?? WATER);
    }
    const ink = kind === WATER ? waterInk(plan, sky, index, x, y) : fixedInk(sky, kind);
    cloud.push({ x: dx, y: dy, ink });
  }
  return cloud;
}

/** The inks a pixel takes whatever its band: damp ground, the far lip, the sheer edge. */
function fixedInk(sky: SkyReflection, kind: number): InkId {
  if (kind === WET) {
    return WET_INK;
  }
  return kind === LIP ? sky.lip : SHALLOW_INK;
}

/** The sky mirrored at one open-water pixel landing at (`x`, `y`). */
function waterInk(plan: BodyPlan, sky: SkyReflection, index: number, x: number, y: number): InkId {
  const threshold = ditherThreshold(x, y);
  const along = plan.along[index] ?? 0;
  // A lake is tall enough for a step between bands to read as a stripe, so it
  // dithers from one band into the next - on the matrix shifted off the one
  // each pair dithers on, or the two patterns would lock together.
  const band = plan.lake ? Math.floor(along) + (along % 1 > ditherThreshold(x + 2, y + 1) ? 1 : 0) : Math.round(along);
  const share = plan.share[index] ?? Number.POSITIVE_INFINITY;
  const deep = share < 1 && (share < SHELF || (1 - share) / (1 - SHELF) > threshold);
  const shallows = plan.lake ? sky.shelf : sky.rows;
  const pair = (deep ? sky.deep[band] : undefined) ?? shallows[band] ?? sky.rows[0];
  if (pair === undefined) {
    return SHALLOW_INK;
  }
  return pair.t > threshold ? pair.b : pair.a;
}
