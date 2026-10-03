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
 * Toward the horizon line the ground takes on the hour's haze - the air between
 * the eye and the far field, so it is computed like the sky it belongs to, in
 * `HAZE_STEPS` tints dithered one step apart. It used to *replace* the ground
 * with haze pixel by pixel instead, and since the lip folds forty rows into its
 * top few scanlines, that made the whole horizon a grey checkerboard that turned
 * green only as it rolled onto the field. Tinted, the far field is still a field.
 *
 * And a far scanline reads a texel in five across and a dozen rows down, so a
 * point sample there is noise that reshuffles on every step of scroll - a crack
 * in a rock cap appears, then is gone. Out there a pixel shows its cell's far
 * look instead (`CellLook.far`, `roll-far.ts`): the colours the ground shows,
 * grass included, one picked per screen pixel. That is what the ground reads as
 * at that distance, in the near lip's own shade; it does not flicker as it
 * slides; and it needs no tile composed - reading the lattice under the far lip
 * is what used to stall a step.
 *
 * Pure: a frame, a width, a cell lookup and the haze in, RGBA out. The renderer
 * wiring - which tile and which tufts a cell has - is `roll-ground-layer.ts`;
 * rock standing on the lip is `roll-rock.ts`, painted over this.
 */

import { scrollOffset, type CameraFrame, type LocalBounds } from "./camera";
import { hexToRgb, type Rgb } from "./color";
import type { InkGrid } from "./ground/ink-grid";
import { HORIZON_SCALE, ROLL_ROWS, rollRowAt, rollScale } from "./horizon";
import { INK_COLORS } from "./ink";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import { countColours, farLook, farSlot, type FarLook } from "./roll-far";
import { TUFT_ROWS, tuftBounds, TuftOverlay, type TuftPiece } from "./roll-grass";
import { BAYER_4X4 } from "./shading";

/** A ground tile as RGBA texels, row 0 at the cell's far edge - how the field blits it. */
export interface TileTexels {
  readonly width: number;
  readonly rgba: Uint8ClampedArray;
}

/**
 * Standing water on the lip, by world texel: the same puddle pixels the field
 * paints, so a puddle rolls over the seam rather than vanishing under it.
 */
export interface WaterLook {
  /** Whether any water or damp ground lies in a cell: asked once per cell, so a dry one costs nothing per pixel. */
  wetCell(cellX: number, cellY: number): boolean;
  /** Lay the water at (gx, gy), if any, over the pixel at byte `at`; true if it hid the ground. */
  blendInto(gx: number, gy: number, rgba: Uint8ClampedArray, at: number): boolean;
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
  /** The puddles out on the lip; leave it out for a dry lip. */
  readonly water?: WaterLook;
  /**
   * A cell seen from too far to point-sample: what it is made of, grass and
   * all, without composing its tile - which needs the lattice round it, and the
   * far lip crosses a hundred cells a scanline. Left out, a far pixel shows its
   * own tile's colours (`tileLook`).
   */
  far?(cellX: number, cellY: number): FarLook;
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
 * How much of the haze's colour the air lends the ground, by how far up the lip
 * it is: none at the seam, `HORIZON_HAZE` on the horizon line.
 *
 * Cubed, so the near half of the lip - the stretch that has to read as the field
 * continuing - is untouched, and the air closes in only over the last rows, which
 * the lip has already compressed into its top few scanlines.
 */
export const HORIZON_HAZE = 0.55;

export function rollFog(lift: number): number {
  const clamped = Math.min(Math.max(lift, 0), 1);
  return HORIZON_HAZE * clamped ** 3;
}

/** How many tints the air is resolved into before dithering: one step is invisible. */
export const HAZE_STEPS = 8;

/**
 * `ditherThreshold` for a whole, non-negative screen pixel - all this file and
 * `roll-rock.ts` ever ask about - without its rounding, which at a lip's worth
 * of pixels a frame was a measurable share of the lip.
 */
function bayerAt(x: number, y: number): number {
  return BAYER_4X4[y & 3]?.[x & 3] ?? 0.5;
}

/**
 * Tint the pixel at byte `at` toward the haze by `fog`, quantised to
 * `HAZE_STEPS` and dithered one step apart on the screen grid, the way the sky
 * resolves its own gradient.
 */
export function hazeInto(rgba: Uint8ClampedArray, at: number, haze: Rgb, fog: number, x: number, y: number): void {
  const level = fog * HAZE_STEPS;
  if (level < 1 / 16) {
    return;
  }
  const step = Math.floor(level) + (level - Math.floor(level) > bayerAt(x, y) ? 1 : 0);
  if (step === 0) {
    return;
  }
  const t = step / HAZE_STEPS;
  rgba[at] = (rgba[at] ?? 0) + (haze.r - (rgba[at] ?? 0)) * t;
  rgba[at + 1] = (rgba[at + 1] ?? 0) + (haze.g - (rgba[at + 1] ?? 0)) * t;
  rgba[at + 2] = (rgba[at + 2] ?? 0) + (haze.b - (rgba[at + 2] ?? 0)) * t;
}

const LOOKS = new WeakMap<TileTexels, FarLook>();

/**
 * A tile's far look: its opaque colours in their shares - inks the tile is
 * made of, never an average. Counted once per tile and kept.
 */
export function tileLook(tile: TileTexels): FarLook {
  let look = LOOKS.get(tile);
  if (look === undefined) {
    look = farLook(countColours(tile.rgba, new Map()));
    LOOKS.set(tile, look);
  }
  return look;
}

/**
 * Share of a scanline's pixels that show their cell's far look rather than a
 * point sample, by how many texels one pixel there spans. None until a pixel
 * spans a couple of texels; all of them once it spans half a tile, so the far
 * lip never composes a tile at all.
 */
export function distantShare(stride: number): number {
  return Math.min(Math.max((stride - 2) / 4, 0), 1);
}

/** One scanline of the roll: the world row it shows and how that row is drawn. */
export interface RollScanline {
  /** Screen y. */
  readonly y: number;
  /** Rows past the field's far edge, continuous. */
  readonly rowsBeyond: number;
  /** Size of that row relative to the flat field - the convergence of its columns. */
  readonly scale: number;
  /** Share of the haze's colour the air lends it. */
  readonly fog: number;
  /** Texels one pixel spans there, across or down, whichever is more. */
  readonly stride: number;
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
    const scale = rollScale(rowsBeyond, height);
    const down = (rollRowAt(lift + 0.5 / height, height) - rollRowAt(lift - 0.5 / height, height)) * TILE_DEPTH;
    return {
      y: frame.groundTop - height + index,
      rowsBeyond,
      scale,
      fog: rollFog(lift),
      stride: Math.max(1 / scale, down),
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
 *
 * `rows` limits the work to a band of scanlines, `[from, to)` from the top -
 * for warming a lip ahead a band a frame; the rest of the result is left black.
 */
export function rollGroundPixels(
  frame: CameraFrame,
  width: number,
  look: CellLook,
  haze: Rgb,
  rows: { readonly from: number; readonly to: number } = { from: 0, to: Number.POSITIVE_INFINITY },
): Uint8ClampedArray {
  const height = Math.max(frame.rollHeight, 0);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const shift = scrollOffset(frame);
  // Local y of the field's far edge: the flat field's own affine answer.
  const seam = (frame.footY + shift.y - frame.groundTop) / TILE_DEPTH;
  const field = new WorldTexels(look, look.grass ?? new TuftOverlay(tuftBounds(frame, width)));

  rollScanlines(frame).forEach((line, index) => {
    if (index < rows.from || index >= rows.to) {
      return;
    }
    const gy = Math.floor((seam + line.rowsBeyond) * TILE_DEPTH);
    const span = TILE_WIDTH * line.scale;
    const tufted = line.rowsBeyond <= TUFT_ROWS;
    const distant = distantShare(line.stride);

    for (let x = 0; x < width; x += 1) {
      const at = (index * width + x) * 4;
      rgba[at + 3] = 255;
      const localX = (x + 0.5 - frame.footX) / span - shift.x / TILE_WIDTH;
      const blurred = distant > 0 && distant > distantThreshold(x, line.y);
      field.write(Math.floor((localX + 0.5) * TILE_WIDTH), gy, rgba, at, tufted, blurred ? farSlot(x, line.y) : -1);
      hazeInto(rgba, at, haze, line.fog, x, line.y);
    }
  });
  return rgba;
}

/**
 * The dither for "point sample or far look", offset from the one the
 * haze uses so the two patterns do not lock together into a visible grid.
 */
export function distantThreshold(x: number, y: number): number {
  return bayerAt(x + 2, y + 1);
}

/** Write a packed `0xRRGGBB` colour, opaque, at byte `at`. */
export function writePacked(rgba: Uint8ClampedArray, at: number, colour: number): void {
  rgba[at] = (colour >> 16) & 0xff;
  rgba[at + 1] = (colour >> 8) & 0xff;
  rgba[at + 2] = colour & 0xff;
  rgba[at + 3] = 255;
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
  /**
   * The cell the last texel was in, and - once some pixel asked - its tile and
   * its far look: a run of texels shares all three, and a far run never
   * composes the tile at all.
   */
  private lastCell = Number.NaN;
  private lastTile: TileTexels | undefined;
  private lastFar: FarLook | undefined;
  /** Whether the last cell has water in it. */
  private lastWet = false;
  /** Whether the tufts round the last cell have been asked for yet. */
  private lastStamped = false;

  constructor(
    private readonly look: CellLook,
    private readonly grass: TuftOverlay,
  ) {}

  /**
   * Write the texel at (gx, gy) into `rgba` at byte `at`, then the water and
   * the grass over it. A `farSlot` of 0 or more asks for that slot of the
   * cell's far look in place of the texel, for a pixel that spans too many
   * texels to point-sample.
   */
  write(gx: number, gy: number, rgba: Uint8ClampedArray, at: number, tufted: boolean, farSlot = -1): void {
    const cellX = Math.floor(gx / TILE_WIDTH);
    const cellY = Math.floor(gy / TILE_DEPTH);
    this.enter(cellX, cellY);
    // A blurred pixel shows no blade of its own - its far look has the grass
    // in it already - so only a pixel that point-samples pays for the tufts.
    const blurred = farSlot >= 0;
    const grassy = tufted && !blurred;
    if (grassy) {
      this.stampAround(cellX, cellY);
    }
    if (blurred) {
      writePacked(rgba, at, this.farLook(cellX, cellY).table[farSlot] ?? 0);
    } else {
      const tile = this.tileHere(cellX, cellY);
      const from = ((TILE_DEPTH - 1 - (gy - cellY * TILE_DEPTH)) * tile.width + (gx - cellX * TILE_WIDTH)) * 4;
      rgba[at] = tile.rgba[from] ?? 0;
      rgba[at + 1] = tile.rgba[from + 1] ?? 0;
      rgba[at + 2] = tile.rgba[from + 2] ?? 0;
    }
    const drowned = this.lastWet && (this.look.water?.blendInto(gx, gy, rgba, at) ?? false);
    if (grassy && !drowned) {
      this.grass.blendInto(gx, gy, rgba, at);
    }
  }

  /** Move to a cell, if the last texel was in another; its tile and far look wait to be asked for. */
  private enter(cellX: number, cellY: number): void {
    const cell = cellKey(cellX, cellY);
    if (cell !== this.lastCell) {
      this.lastCell = cell;
      this.lastTile = undefined;
      this.lastFar = undefined;
      this.lastWet = this.look.water?.wetCell(cellX, cellY) ?? false;
      this.lastStamped = false;
    }
  }

  private tileHere(cellX: number, cellY: number): TileTexels {
    this.lastTile ??= this.look.tile(cellX, cellY);
    return this.lastTile;
  }

  private farLook(cellX: number, cellY: number): FarLook {
    this.lastFar ??= this.look.far?.(cellX, cellY) ?? tileLook(this.tileHere(cellX, cellY));
    return this.lastFar;
  }

  /** The tufts that can reach this cell's texels, asked for once per visit to the cell. */
  private stampAround(cellX: number, cellY: number): void {
    if (this.lastStamped) {
      return;
    }
    this.lastStamped = true;
    for (const [dx, dy] of TUFT_REACH) {
      this.stamp(cellX + dx, cellY + dy);
    }
  }

  private stamp(cellX: number, cellY: number): void {
    if (!this.grass.holds(cellX, cellY)) {
      this.grass.stamp(cellX, cellY, this.look.tuft(cellX, cellY));
    }
  }
}
