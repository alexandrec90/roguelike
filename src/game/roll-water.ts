/**
 * Standing water on the horizon lip.
 *
 * The water layer paints its puddles under the lip (`PUDDLE_DEPTH` is below
 * `HORIZON_DEPTH`), so a puddle that walked past the field's far edge used to
 * vanish whole the moment it reached the seam. The lip now carries it on: the
 * same puddles, grown from the same sites with the same seeds and radii, their
 * still bodies (`puddleBody`) laid into world texels - the address the lip reads
 * its tiles by - so at the seam the lip shows exactly the pixels the field
 * would, and past it the puddle shrinks and climbs like everything else there.
 *
 * Only the still body: the glints and rings are a few pixels that would land
 * on a scanline or two, and they are the field's business.
 *
 * Pure: puddles and a sky in, a lookup out. Built once a step by the layer.
 */

import type { CameraFrame } from "./camera";
import { ROLL_ROWS, rollScale } from "./horizon";
import type { LocalPoint } from "./planet";
import { hexToRgb } from "./color";
import { INK_ALPHA, INK_COLORS, type InkId, type PixelCloud } from "./ink";
import type { Puddle } from "./puddles";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import type { WaterLook } from "./roll-ground";
import { relativeBody, WET_INK } from "./water/body";
import type { SkyReflection } from "./water/sky-inks";

interface WaterTexel {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** 0..1, the ink's own. */
  readonly a: number;
  /** The water itself, rather than the damp ground round it. */
  readonly water: boolean;
}

/** Each ink as a texel, resolved once and shared: a rebuild allocates nothing per pixel. */
const TEXELS = new Map<InkId, WaterTexel>();

function texelOf(ink: InkId): WaterTexel {
  let texel = TEXELS.get(ink);
  if (texel === undefined) {
    texel = { ...hexToRgb(INK_COLORS[ink]), a: INK_ALPHA[ink], water: ink !== WET_INK };
    TEXELS.set(ink, texel);
  }
  return texel;
}

/** One number per world texel. */
function texelKey(gx: number, gy: number): number {
  return (gx + 0x8000) * 0x10000 + (gy + 0x8000);
}

/**
 * Every distinct ink alpha the lip's water has used, in the order first seen.
 * A page stores an index into this rather than the alpha, so the shader blends
 * with exactly the alpha the CPU does (`lip-gpu-data.ts`).
 */
export const WATER_ALPHAS: number[] = [];

/** Most alphas a page code can name: seven bits, less the zero that means "no water". */
export const MAX_WATER_ALPHAS = 127;

/** A texel's code: 0 for none, else 1 + its alpha's index, plus 128 for water rather than damp ground. */
export function waterCode(alpha: number, water: boolean): number {
  let index = WATER_ALPHAS.indexOf(alpha);
  if (index < 0) {
    if (WATER_ALPHAS.length >= MAX_WATER_ALPHAS) {
      throw new Error("More distinct water alphas than a page code can name");
    }
    WATER_ALPHAS.push(alpha);
    index = WATER_ALPHAS.length - 1;
  }
  return 1 + index + (water ? 128 : 0);
}

/**
 * How far short of the seam a puddle's centre can be and still reach over it,
 * rows: a puddle's depth, and its damp ring.
 */
const PUDDLE_OVERHANG = 1.5;

/**
 * Whether water centred at a local point, reaching `extent` tiles from it, can
 * show on the lip: no nearer than its own depth short of the seam - nearer
 * than that it is wholly the field's - no farther than the horizon, and inside
 * the cone the lip's columns fan out over as its rows recede. A lake's extent
 * is several tiles, so one whose centre is still on the field carries its far
 * shore over the seam rather than being cut off at it. Left out, the extent is
 * a puddle's, which the margins already allow for.
 */
export function puddleOnLip(
  frame: CameraFrame,
  width: number,
  local: LocalPoint,
  extent: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
): boolean {
  const beyond = local.y - (frame.footY - frame.groundTop) / TILE_DEPTH;
  if (beyond < -Math.max(PUDDLE_OVERHANG, extent.y + 0.5) || beyond - extent.y > ROLL_ROWS + 1) {
    return false;
  }
  // The far shore is where the cone is widest.
  const scale = rollScale(Math.max(beyond + extent.y, 0), frame.rollHeight);
  const reach = Math.max(frame.footX, width - frame.footX) / (TILE_WIDTH * scale) + 1;
  return Math.abs(local.x) - extent.x <= reach;
}

/**
 * The world texel under a zero-phase screen pixel: `x` right of the hero's
 * column by the tile's half-width, `y` counted forward from his feet. The
 * inverse of how the field blits a tile, which is the whole of the seam match.
 */
export function screenToTexel(frame: CameraFrame, x: number, y: number): { gx: number; gy: number } {
  return { gx: x - frame.footX + TILE_WIDTH / 2, gy: frame.footY - 1 - y };
}

/** One body's texels about its centre, and the box they fill: built once per body, shared by every step. */
interface BodyTexels {
  readonly texels: ReadonlyMap<number, WaterTexel>;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Keyed by the cached body itself, so a body's texels live exactly as long as it does. */
const BODY_TEXELS = new WeakMap<PixelCloud, BodyTexels>();

function bodyTexels(body: PixelCloud): BodyTexels {
  let known = BODY_TEXELS.get(body);
  if (known === undefined) {
    const texels = new Map<number, WaterTexel>();
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const pixel of body) {
      // Screen y runs down and texel rows run forward, so the body's rows flip.
      const dy = -pixel.y;
      texels.set(texelKey(pixel.x, dy), texelOf(pixel.ink));
      minX = Math.min(minX, pixel.x);
      maxX = Math.max(maxX, pixel.x);
      minY = Math.min(minY, dy);
      maxY = Math.max(maxY, dy);
    }
    known = { texels, minX, maxX, minY, maxY };
    BODY_TEXELS.set(body, known);
  }
  return known;
}

/** The dither phase water wholly out on the lip is inked at: any one, so long as it is always the same. */
const FAR_DITHER = { x: 0, y: 0 } as const;

/**
 * Whether a lake lies wholly past the seam with a row to spare, so no pixel of
 * it is point-sampled 1:1 against the field and its dither phase cannot be
 * seen. A puddle never qualifies: its bodies are few and small, and keeping
 * them exact keeps every one the field hands over identical at the seam.
 */
function pastSeam(frame: CameraFrame, puddle: Puddle): boolean {
  const nearest = puddle.centerY + Math.ceil(puddle.radiusY * 1.4) + 2;
  return puddle.lake && nearest < frame.groundTop - TILE_DEPTH;
}

/** A body laid on the lip: its texels, and the world texel its centre landed on. */
interface PlacedBody {
  readonly body: BodyTexels;
  readonly gx: number;
  readonly gy: number;
}

export class LipWater implements WaterLook {
  /**
   * The bodies whose box reaches into each cell, in the order grown, so a later
   * one wins a texel two share. A lake is ten thousand texels, and copying them
   * into one map every step was ten milliseconds of the crossing; placing it is
   * a few hundred cell entries.
   */
  private readonly cells = new Map<number, PlacedBody[]>();
  private readonly placed: PlacedBody[] = [];

  /** `frame` is the zero-phase frame the puddles were grown on. */
  constructor(frame: CameraFrame, puddles: readonly Puddle[], sky: SkyReflection) {
    for (const puddle of puddles) {
      const origin = screenToTexel(frame, puddle.centerX, puddle.centerY);
      const body = bodyTexels(relativeBody(puddle, sky, pastSeam(frame, puddle) ? FAR_DITHER : undefined));
      const placed = { body, gx: origin.gx, gy: origin.gy };
      this.placed.push(placed);
      const fromX = Math.floor((origin.gx + body.minX) / TILE_WIDTH);
      const toX = Math.floor((origin.gx + body.maxX) / TILE_WIDTH);
      const fromY = Math.floor((origin.gy + body.minY) / TILE_DEPTH);
      const toY = Math.floor((origin.gy + body.maxY) / TILE_DEPTH);
      for (let cellY = fromY; cellY <= toY; cellY += 1) {
        for (let cellX = fromX; cellX <= toX; cellX += 1) {
          const key = texelKey(cellX, cellY);
          const list = this.cells.get(key);
          if (list === undefined) {
            this.cells.set(key, [placed]);
          } else {
            list.push(placed);
          }
        }
      }
    }
  }

  /** How many texels hold water or damp ground, counting each once. */
  get size(): number {
    const seen = new Set<number>();
    for (const { body, gx, gy } of this.placed) {
      for (const key of body.texels.keys()) {
        const dx = Math.floor(key / 0x10000) - 0x8000;
        const dy = (key % 0x10000) - 0x8000;
        seen.add(texelKey(gx + dx, gy + dy));
      }
    }
    return seen.size;
  }

  /** Whether any body's box reaches into a cell: a dry cell is one lookup, and a wet one is checked per texel. */
  wetCell(cellX: number, cellY: number): boolean {
    return this.cells.has(texelKey(cellX, cellY));
  }

  /** The texel at a world texel, from the last body grown over it. */
  private texelAt(gx: number, gy: number): WaterTexel | undefined {
    const list = this.cells.get(texelKey(Math.floor(gx / TILE_WIDTH), Math.floor(gy / TILE_DEPTH)));
    if (list === undefined) {
      return undefined;
    }
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const placed = list[index];
      const texel = placed?.body.texels.get(texelKey(gx - placed.gx, gy - placed.gy));
      if (texel !== undefined) {
        return texel;
      }
    }
    return undefined;
  }

  /**
   * A cell's water as a 16 x 12 page for the lip's shader: per texel its colour
   * and `waterCode`, row 0 the cell's nearest texel row (`gy = cellY * 12`).
   * `at` is the byte offset of the page's top-left in `data`, `stride` the bytes
   * per row there.
   */
  page(cellX: number, cellY: number, data: Uint8Array, at: number, stride: number): void {
    for (let row = 0; row < TILE_DEPTH; row += 1) {
      for (let column = 0; column < TILE_WIDTH; column += 1) {
        const texel = this.texelAt(cellX * TILE_WIDTH + column, cellY * TILE_DEPTH + row);
        if (texel !== undefined) {
          data.set([texel.r, texel.g, texel.b, waterCode(texel.a, texel.water)], at + row * stride + column * 4);
        }
      }
    }
  }

  blendInto(gx: number, gy: number, rgba: Uint8ClampedArray, at: number): boolean {
    const texel = this.texelAt(gx, gy);
    if (texel === undefined) {
      return false;
    }
    const keep = 1 - texel.a;
    rgba[at] = texel.r * texel.a + (rgba[at] ?? 0) * keep;
    rgba[at + 1] = texel.g * texel.a + (rgba[at + 1] ?? 0) * keep;
    rgba[at + 2] = texel.b * texel.a + (rgba[at + 2] ?? 0) * keep;
    return texel.water;
  }
}
