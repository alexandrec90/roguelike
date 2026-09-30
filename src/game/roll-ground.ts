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
 * pixel on it reads the texel of the tile the ground layer composes in that
 * cell - nearest texel, no blending, so each pixel on screen is a pixel the
 * field has too. At the seam the answer is exactly 1:1, which is the whole point:
 * the first scanlines of the lip are the same pixels the tile blit would have
 * put there, and the field runs onto the curve without a line. Further up, rows
 * of texels are skipped as the lip compresses and columns converge on the
 * hero's own, by the very scale that shrinks a tree standing there.
 *
 * Toward the horizon line the ground dissolves into the hour's haze through the
 * 4x4 Bayer dither, locked to the screen grid, so distance fades it without a
 * new colour and without a gradient anyone painted.
 *
 * Pure: a frame, a width, a cell lookup and the haze in, RGBA out. The Phaser
 * wiring - which tile and which tufts a cell has - is `roll-ground-layer.ts`.
 */

import { scrollOffset, type CameraFrame, type LocalBounds } from "./camera";
import { hexToRgb, type Rgb } from "./color";
import type { InkGrid } from "./ground/ink-grid";
import { HORIZON_SCALE, ROLL_ROWS, rollRowAt, rollScale } from "./horizon";
import { INK_COLORS } from "./ink";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import { TUFT_ROWS, tuftBounds, TuftOverlay, type TuftPiece } from "./roll-grass";
import { ditherThreshold } from "./shading";

/** A ground tile as RGBA texels, row 0 at the cell's far edge - how the field blits it. */
export interface TileTexels {
  readonly width: number;
  readonly rgba: Uint8ClampedArray;
}

/**
 * What the field shows in a local cell: the tile the ground layer composes
 * there, and the grass rooted in it. The same two answers the ground and the
 * vegetation layer give, so the lip is the field carried on.
 */
export interface CellLook {
  tile(cellX: number, cellY: number): TileTexels;
  /**
   * Every tuft rooted in the cell, each placed from the middle of the cell's
   * near edge - its foot - with y negative going up; null for none.
   */
  tuft(cellX: number, cellY: number): readonly TuftPiece[] | null;
  /**
   * Where the tufts are stamped. Keep one between frames and a tuft already in
   * is not asked for again; leave it out and every frame starts empty.
   */
  readonly grass?: TuftOverlay;
}

/** An ink grid - a ground or rock tile - as texels; a transparent pixel is black. */
export function gridTexels(grid: InkGrid): TileTexels {
  const rgba = new Uint8ClampedArray(grid.width * grid.height * 4);
  grid.inks.forEach((ink, index) => {
    if (ink === null) {
      rgba[index * 4 + 3] = 255;
      return;
    }
    const colour = hexToRgb(INK_COLORS[ink]);
    rgba.set([colour.r, colour.g, colour.b, 255], index * 4);
  });
  return { width: grid.width, rgba };
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
 * Every local cell the lip can show, for a frame and a width: from a row short
 * of the seam - a stride in flight slides the seam by up to a row, and a blade
 * rises out of the cell nearer than the one it covers - out to `ROLL_ROWS` past
 * it and a little over, as wide as the screen is at the horizon's smallest scale.
 */
export function lipBounds(frame: CameraFrame, width: number): LocalBounds {
  const seam = (frame.footY - frame.groundTop) / TILE_DEPTH;
  const span = TILE_WIDTH * HORIZON_SCALE;
  return {
    minX: Math.floor(-frame.footX / span) - 2,
    maxX: Math.ceil((width - frame.footX) / span) + 2,
    minY: Math.floor(seam) - 2,
    maxY: Math.ceil(seam + ROLL_ROWS) + 2,
  };
}

/**
 * The roll's ground as RGBA, `width` by `frame.rollHeight`.
 *
 * Coordinates are **world texels**: `gx` runs right and `gy` runs forward, one
 * per pixel of a tile, so a tile's texel and a tuft's pixel are the same kind
 * of thing at the same address, and a blade that leans over its cell's edge
 * lands on the neighbour's texel exactly as it does on the field.
 *
 * The scroll is the one `scrollOffset` the tile field is moved by, rounded the
 * same way, so the lip and the field cannot shear against each other mid-stride.
 *
 * `haze` is the air the far ground dissolves into, already divided by the
 * ambient (`unlitHaze`): the ground is lit by the lighting pass like the field,
 * and the haze then lands on the sky's own colour at the horizon line.
 */
export function rollGroundPixels(frame: CameraFrame, width: number, look: CellLook, haze: Rgb): Uint8ClampedArray {
  const height = Math.max(frame.rollHeight, 0);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const shift = scrollOffset(frame);
  // Local y of the field's far edge: the flat field's own affine answer.
  const seam = (frame.footY + shift.y - frame.groundTop) / TILE_DEPTH;
  const field = new WorldTexels(look, look.grass ?? new TuftOverlay(tuftBounds(frame, width)));

  rollScanlines(frame).forEach((line, index) => {
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

/**
 * Cells whose tufts can reach a texel: its own, and the next one *nearer* - a
 * blade rises forward, out of its cell into the farther one - a column either
 * side. The scanlines run far first, so the nearer cell has to be stamped
 * before any of its own texels are drawn; farther first within the pair, so
 * the nearer blade is the one on top, as it is on the field.
 */
const TUFT_REACH = [0, -1].flatMap((dy) => [-1, 0, 1].map((dx) => [dx, dy] as const));

/** One number per cell, compared once per texel. */
function cellKey(cellX: number, cellY: number): number {
  return (cellX + 0x8000) * 0x10000 + (cellY + 0x8000);
}

/**
 * The field as a function of world texel: tile art under, tufts stamped over.
 *
 * Tufts are stamped lazily, a cell at a time, the first time any texel they
 * could cover is asked for - so the far lip, where a scanline crosses a hundred
 * cells, pays for the tufts it reads and no others - and into an overlay the
 * caller may keep between frames, so a tuft already in is not stamped again.
 */
class WorldTexels {
  /** The cell the last texel was in, and its tile: a run of texels shares both. */
  private lastCell = Number.NaN;
  private lastTile: TileTexels | undefined;

  constructor(
    private readonly look: CellLook,
    private readonly grass: TuftOverlay,
  ) {}

  /** Write the texel at (gx, gy) into `rgba` at byte `at`, with the grass over it or not. */
  write(gx: number, gy: number, rgba: Uint8ClampedArray, at: number, tufted: boolean): void {
    const cellX = Math.floor(gx / TILE_WIDTH);
    const cellY = Math.floor(gy / TILE_DEPTH);
    const cell = cellKey(cellX, cellY);
    if (cell !== this.lastCell) {
      this.lastCell = cell;
      this.lastTile = this.look.tile(cellX, cellY);
      if (tufted) {
        for (const [dx, dy] of TUFT_REACH) {
          this.stamp(cellX + dx, cellY + dy);
        }
      }
    }
    const tile = this.lastTile ?? this.look.tile(cellX, cellY);
    const u = gx - cellX * TILE_WIDTH;
    const v = TILE_DEPTH - 1 - (gy - cellY * TILE_DEPTH);
    const from = (v * tile.width + u) * 4;
    rgba[at] = tile.rgba[from] ?? 0;
    rgba[at + 1] = tile.rgba[from + 1] ?? 0;
    rgba[at + 2] = tile.rgba[from + 2] ?? 0;
    if (tufted) {
      this.grass.blendInto(gx, gy, rgba, at);
    }
  }

  private stamp(cellX: number, cellY: number): void {
    if (!this.grass.holds(cellX, cellY)) {
      this.grass.stamp(cellX, cellY, this.look.tuft(cellX, cellY));
    }
  }
}
