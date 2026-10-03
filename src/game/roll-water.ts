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
import { INK_ALPHA, INK_COLORS, type InkId } from "./ink";
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
 * Whether a puddle centred at a local point can show on the lip: no nearer
 * than a puddle's depth short of the seam - nearer than that it is wholly the
 * field's - no farther than the horizon, and inside the cone the lip's columns
 * fan out over as its rows recede.
 */
export function puddleOnLip(frame: CameraFrame, width: number, local: LocalPoint): boolean {
  const beyond = local.y - (frame.footY - frame.groundTop) / TILE_DEPTH;
  if (beyond < -1.5 || beyond > ROLL_ROWS + 1) {
    return false;
  }
  const scale = rollScale(Math.max(beyond, 0), frame.rollHeight);
  const reach = Math.max(frame.footX, width - frame.footX) / (TILE_WIDTH * scale) + 1;
  return Math.abs(local.x) <= reach;
}

/**
 * The world texel under a zero-phase screen pixel: `x` right of the hero's
 * column by the tile's half-width, `y` counted forward from his feet. The
 * inverse of how the field blits a tile, which is the whole of the seam match.
 */
export function screenToTexel(frame: CameraFrame, x: number, y: number): { gx: number; gy: number } {
  return { gx: x - frame.footX + TILE_WIDTH / 2, gy: frame.footY - 1 - y };
}

export class LipWater implements WaterLook {
  private readonly texels = new Map<number, WaterTexel>();
  /** Every cell with a texel of water or damp ground in it, so a dry cell is one lookup. */
  private readonly cells = new Set<number>();

  /** `frame` is the zero-phase frame the puddles were grown on. */
  constructor(frame: CameraFrame, puddles: readonly Puddle[], sky: SkyReflection) {
    for (const puddle of puddles) {
      const origin = screenToTexel(frame, puddle.centerX, puddle.centerY);
      // Screen y runs down and texel rows run forward, so the body's rows flip.
      for (const pixel of relativeBody(puddle, sky)) {
        const gx = origin.gx + pixel.x;
        const gy = origin.gy - pixel.y;
        this.texels.set(texelKey(gx, gy), texelOf(pixel.ink));
        this.cells.add(texelKey(Math.floor(gx / TILE_WIDTH), Math.floor(gy / TILE_DEPTH)));
      }
    }
  }

  /** How many texels hold water or damp ground. */
  get size(): number {
    return this.texels.size;
  }

  wetCell(cellX: number, cellY: number): boolean {
    return this.cells.has(texelKey(cellX, cellY));
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
        const texel = this.texels.get(texelKey(cellX * TILE_WIDTH + column, cellY * TILE_DEPTH + row));
        if (texel !== undefined) {
          data.set([texel.r, texel.g, texel.b, waterCode(texel.a, texel.water)], at + row * stride + column * 4);
        }
      }
    }
  }

  blendInto(gx: number, gy: number, rgba: Uint8ClampedArray, at: number): boolean {
    const texel = this.texels.get(texelKey(gx, gy));
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
