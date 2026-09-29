/**
 * The ground on the horizon roll: the flat field carried over the lip.
 *
 * The roll used to be a stack of flat haze stripes, one per world row, laid over
 * the tiles. That was honest while it was seven scanlines of hard fold, and it
 * is what made the seam read as a seam: textured field, then a band of nothing.
 * Now the roll is a lip (`rollLift`) whose first row is as tall as a flat one,
 * and a stripe twelve scanlines tall is a stripe. So the lip shows the ground.
 *
 * Every scanline of the roll asks the same curve a body standing there does
 * which world row it is looking at and how small that row has become, and every
 * pixel on it reads the terrain at that point and the authored tile's texel
 * under it - nearest texel, no blending, so each pixel on screen is a pixel an
 * author drew. At the seam the answer is exactly 1:1, which is the whole point:
 * the first scanlines of the lip are the same pixels the tile blit would have
 * put there, and the field runs onto the curve without a line. Further up, rows
 * of texels are skipped as the lip compresses and columns converge on the
 * hero's own, by the very scale that shrinks a tree standing there.
 *
 * Toward the horizon line the ground dissolves into the haze through the 4x4
 * Bayer dither, locked to the screen grid, so distance darkens it without a new
 * colour and without a gradient anyone painted.
 *
 * Pure: a frame, a width and a terrain lookup in, RGBA out. The Phaser wiring
 * is `roll-ground-layer.ts`.
 */

import { scrollOffset, type CameraFrame } from "./camera";
import { hexToRgb, type Rgb } from "./color";
import { rollHaze, rollRowAt, rollScale } from "./horizon";
import { INK_ALPHA, INK_COLORS, type InkId, type PixelCloud } from "./ink";
import { rasterizeSprite, type RasterizedSprite } from "./pixel-art";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import { ditherThreshold } from "./shading";
import type { Terrain } from "./terrain";
import { DIRT_PATH, GRASS, WALL_TOP } from "./tiles";

/**
 * What the field shows in a local cell: the terrain its tile is blitted as, and
 * the grass tuft rooted at its foot, if it has one. The same two answers the
 * tile grid and the vegetation layer give, so the lip is the field carried on.
 */
export interface CellLook {
  terrain(cellX: number, cellY: number): Terrain;
  /** Foot-anchored, exactly as the vegetation layer draws it; null for none. */
  tuft(cellX: number, cellY: number): PixelCloud | null;
}

let texels: Readonly<Record<Terrain, RasterizedSprite>> | undefined;

/** The tile each terrain is blitted as on the field, rasterised once. */
function tileTexels(): Readonly<Record<Terrain, RasterizedSprite>> {
  texels ??= {
    grass: rasterizeSprite(GRASS),
    dirt: rasterizeSprite(DIRT_PATH),
    rock: rasterizeSprite(WALL_TOP),
  };
  return texels;
}

/**
 * How much of a scanline is haze rather than ground, by how far up the lip it is.
 *
 * Squared so the near half of the lip stays almost entirely ground - that is the
 * stretch that has to read as the field continuing - and the haze closes in over
 * the stretch that is already compressed past legibility.
 */
export function rollFog(lift: number): number {
  const clamped = Math.min(Math.max(lift, 0), 1);
  return clamped * clamped;
}

/** One scanline of the roll: the world row it shows and how that row is drawn. */
export interface RollScanline {
  /** Screen y. */
  readonly y: number;
  /** Rows past the field's far edge, continuous. */
  readonly rowsBeyond: number;
  /** Size of that row relative to the flat field - the convergence of its columns. */
  readonly scale: number;
  /** Share of the scanline dithered to haze. */
  readonly fog: number;
}

/**
 * The roll's scanlines, top (horizon line) first.
 *
 * Each is sampled at its pixel centre, so the bottom scanline sits half a
 * scanline past the seam - exactly where the flat field's next scanline would.
 */
export function rollScanlines(frame: CameraFrame): readonly RollScanline[] {
  const height = frame.rollHeight;
  return Array.from({ length: Math.max(height, 0) }, (_unused, index) => {
    const lift = (height - index - 0.5) / height;
    const rowsBeyond = rollRowAt(lift, height);
    return {
      y: frame.groundTop - height + index,
      rowsBeyond,
      scale: rollScale(rowsBeyond, height),
      fog: rollFog(lift),
    };
  });
}

/**
 * The roll's ground as RGBA, `width` by `frame.rollHeight`.
 *
 * Coordinates are **world texels**: `gx` runs right and `gy` runs forward, one
 * per authored pixel of a tile, so a tile's texel and a tuft's pixel are the
 * same kind of thing at the same address, and a blade that leans over its
 * cell's edge lands on the neighbour's texel exactly as it does on the field.
 *
 * The scroll is the one `scrollOffset` the tile field is moved by, rounded the
 * same way, so the lip and the field cannot shear against each other mid-stride.
 */
/**
 * Rows past the seam over which the grass tufts are drawn on the lip.
 *
 * Past this the lip is more than four-fifths haze (`rollFog`) and a tuft is a
 * texel in five, so a blade there changes nothing anyone can see - while a
 * scanline out there crosses a hundred cells, and stamping their tufts was most
 * of the cost of a frame of lip.
 */
export const TUFT_ROWS = 8;

export function rollGroundPixels(frame: CameraFrame, width: number, look: CellLook): Uint8ClampedArray {
  const height = Math.max(frame.rollHeight, 0);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const shift = scrollOffset(frame);
  // Local y of the field's far edge: the flat field's own affine answer.
  const seam = (frame.footY + shift.y - frame.groundTop) / TILE_DEPTH;
  const field = new WorldTexels(look);

  rollScanlines(frame).forEach((line, index) => {
    const haze = hexToRgb(rollHaze(line.rowsBeyond));
    const gy = Math.floor((seam + line.rowsBeyond) * TILE_DEPTH);
    const span = TILE_WIDTH * line.scale;
    const tufted = line.rowsBeyond <= TUFT_ROWS;

    for (let x = 0; x < width; x += 1) {
      const at = (index * width + x) * 4;
      rgba[at + 3] = 255;
      if (line.fog > ditherThreshold(x, line.y)) {
        rgba[at] = haze.r;
        rgba[at + 1] = haze.g;
        rgba[at + 2] = haze.b;
        continue;
      }
      const localX = (x + 0.5 - frame.footX) / span - shift.x / TILE_WIDTH;
      field.write(Math.floor((localX + 0.5) * TILE_WIDTH), gy, rgba, at, tufted);
    }
  });
  return rgba;
}

/** A tuft pixel over the tile: an ink's colour and that ink's own opacity. */
interface Stamp extends Rgb {
  readonly a: number;
}

/** Cells whose tufts can reach a texel: its own and the next one forward, a column either side. */
const TUFT_REACH = [-1, 0, 1].flatMap((dx) => [0, 1].map((dy) => [dx, dy] as const));

/** One number per world texel or cell, for maps that are read a few thousand times a frame. */
function texelKey(gx: number, gy: number): number {
  return (gx + 0x8000) * 0x10000 + (gy + 0x8000);
}

/**
 * The field as a function of world texel: tile art under, tufts stamped over.
 *
 * Tufts are stamped lazily, a cell at a time, the first time any texel they
 * could cover is asked for - so the far lip, where a scanline crosses a hundred
 * cells, pays for the tufts it reads and no others.
 */
class WorldTexels {
  private readonly tiles = tileTexels();
  private readonly stamped = new Set<number>();
  private readonly tufts = new Map<number, Stamp>();
  private lastCell = Number.NaN;

  constructor(private readonly look: CellLook) {}

  /** Write the texel at (gx, gy) into `rgba` at byte `at`, with the grass over it or not. */
  write(gx: number, gy: number, rgba: Uint8ClampedArray, at: number, tufted: boolean): void {
    const cellX = Math.floor(gx / TILE_WIDTH);
    const cellY = Math.floor(gy / TILE_DEPTH);
    const cell = texelKey(cellX, cellY);
    if (tufted && cell !== this.lastCell) {
      this.lastCell = cell;
      for (const [dx, dy] of TUFT_REACH) {
        this.stamp(cellX + dx, cellY + dy);
      }
    }
    const tile = this.tiles[this.look.terrain(cellX, cellY)];
    const u = gx - cellX * TILE_WIDTH;
    const v = TILE_DEPTH - 1 - (gy - cellY * TILE_DEPTH);
    const from = (v * tile.width + u) * 4;
    const r = tile.rgba[from] ?? 0;
    const g = tile.rgba[from + 1] ?? 0;
    const b = tile.rgba[from + 2] ?? 0;
    const over = tufted ? this.tufts.get(texelKey(gx, gy)) : undefined;
    if (over === undefined) {
      rgba[at] = r;
      rgba[at + 1] = g;
      rgba[at + 2] = b;
      return;
    }
    rgba[at] = Math.round(r + (over.r - r) * over.a);
    rgba[at + 1] = Math.round(g + (over.g - g) * over.a);
    rgba[at + 2] = Math.round(b + (over.b - b) * over.a);
  }

  private stamp(cellX: number, cellY: number): void {
    const key = texelKey(cellX, cellY);
    if (this.stamped.has(key)) {
      return;
    }
    this.stamped.add(key);
    for (const pixel of this.look.tuft(cellX, cellY) ?? []) {
      // A foot-anchored cloud's row y sits on the scanline `y` below the foot,
      // which is world texel row `cellY * TILE_DEPTH - y - 1`.
      const gx = cellX * TILE_WIDTH + TILE_WIDTH / 2 + pixel.x;
      const gy = cellY * TILE_DEPTH - pixel.y - 1;
      this.tufts.set(texelKey(gx, gy), inkStamp(pixel.ink));
    }
  }
}

const stamps = new Map<InkId, Stamp>();

/** An ink as a stamp, parsed once rather than once per blade pixel per frame. */
function inkStamp(ink: InkId): Stamp {
  let stamp = stamps.get(ink);
  if (stamp === undefined) {
    stamp = { ...hexToRgb(INK_COLORS[ink]), a: INK_ALPHA[ink] };
    stamps.set(ink, stamp);
  }
  return stamp;
}
