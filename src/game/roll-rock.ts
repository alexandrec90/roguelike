/**
 * Rock standing on the horizon lip.
 *
 * On the flat field an outcrop stands: a cap lifted `WALL_RISE` scanlines and a
 * face under it (`ground-layer.ts`). The lip used to lay every rock flat - its
 * cap only, hazed - while the field's last grid rows, which hang above the seam,
 * kept drawing theirs standing. So a ridge walked toward was a grey smear on the
 * lip with a wall floating in the sky above it, and the wall dropped into place
 * as the row crossed the seam. Now the lip stands rock up too, by the same
 * curve every tree on it is drawn by: a cell `d` rows past the seam rises
 * `WALL_RISE * rollScale(d)` from the ground at `rollLift(d)`. At the seam that
 * is exactly the field's wall, so an outcrop rolls on whole, and toward the
 * horizon it shrinks into a low grey line - the mountains on the skyline are
 * the rock on the planet, not a painting.
 *
 * Drawn the way a heightfield is: one screen column at a time, marching away
 * from the seam in steps small enough that no scanline is skipped, keeping the
 * highest scanline painted so far. A nearer wall hides a farther one because it
 * was reached first. Where a column climbs onto rock out of open ground it is
 * looking at the rock's face; where it keeps climbing on rock it is looking
 * across the cap.
 *
 * A body sinks as it nears the horizon line, the curve of the planet hiding its
 * foot first (`HORIZON_SINK`), so an outcrop rises over the skyline as it is
 * approached rather than appearing on it at full height.
 *
 * The field still owns any cell whose near edge is on the field: those rows stay
 * standing in `ground-layer.ts` and are drawn over the lip, nearer than it.
 *
 * Pure: a frame, a lookup and the haze in, pixels written into a buffer that
 * spans the whole band above the field. The wiring is `roll-ground-layer.ts`.
 */

import { scrollOffset, type CameraFrame } from "./camera";
import { hexToRgb, type Rgb } from "./color";
import type { InkGrid } from "./ground/ink-grid";
import { ROLL_ROWS, rollLift, rollScale } from "./horizon";
import { INK_COLORS } from "./ink";
import { TILE_DEPTH, TILE_WIDTH, WALL_RISE } from "./projection";
import {
  distantShare,
  distantThreshold,
  hazeInto,
  rollFog,
  tileMode,
  writePacked,
  type TileTexels,
} from "./roll-ground";

/**
 * A rock cell on the lip: what lies on top, and what stands at the front.
 *
 * `cap` and `face` are read only for a pixel that point-samples them, so a
 * caller may compose them lazily; `far` is what a pixel too far to sample shows
 * instead, and with it the far wall never composes a tile at all.
 */
export interface RockLook {
  /** The cap - the tile the ground layer composes in the cell. */
  readonly cap: TileTexels;
  /** The face, `WALL_RISE` rows of texels, transparent where the art is. */
  readonly face: TileTexels;
  /** Packed `0xRRGGBB` colours of cap and face from afar; left out, each tile's commonest. */
  readonly far?: { readonly cap: number; readonly face: number };
}

/** A cell's rock, or null for open ground. */
export type RockAt = (cellX: number, cellY: number) => RockLook | null;

/** Rows short of the horizon over which a body sinks behind the curve. */
export const HORIZON_SINK = 8;

/** One step of the march away from the seam: the same for every column. */
export interface RockSample {
  /** Rows past the seam. */
  readonly rowsBeyond: number;
  /** Screen y of the ground there, continuous. */
  readonly groundY: number;
  /** Scanlines a rock standing there rises above it. */
  readonly rise: number;
  readonly scale: number;
  readonly fog: number;
  /** Texels one pixel spans there, for the cap and the face alike. */
  readonly stride: number;
}

/**
 * Largest move of a wall's top up the screen between two steps, in scanlines.
 * Each step paints the whole span it uncovered, so a scanline is enough: a
 * finer march only re-reads the same texel.
 */
const STEP_SCANLINES = 1;
/** Largest step along the ground, in rows: a step of one row cannot pass over a cell. */
const STEP_ROWS = 1;

function sampleAt(groundTop: number, rollHeight: number, rowsBeyond: number): RockSample {
  const scale = rollScale(rowsBeyond, rollHeight);
  const sink = Math.min(Math.max((ROLL_ROWS - rowsBeyond) / HORIZON_SINK, 0), 1);
  const lift = rollLift(rowsBeyond, rollHeight);
  const slope = (rollLift(rowsBeyond + 0.01, rollHeight) - lift) * rollHeight * 100;
  return {
    rowsBeyond,
    groundY: groundTop - rollHeight * Math.min(lift, 1),
    rise: WALL_RISE * scale * sink,
    scale,
    fog: rollFog(lift),
    stride: Math.max(1 / scale, TILE_DEPTH / Math.max(slope, 1e-3)),
  };
}

const SAMPLES = new Map<string, readonly RockSample[]>();

/**
 * The march from the seam to the horizon line for a band of this shape, each
 * step as long as it can be without the top of a wall jumping a scanline.
 * Depends on the layout only, so it is worked out once and kept.
 */
export function rockSamples(groundTop: number, rollHeight: number): readonly RockSample[] {
  const key = `${groundTop}:${rollHeight}`;
  const known = SAMPLES.get(key);
  if (known !== undefined) {
    return known;
  }
  const samples: RockSample[] = [];
  let rows = 0;
  while (rows <= ROLL_ROWS && rollHeight > 0) {
    const here = sampleAt(groundTop, rollHeight, rows);
    samples.push(here);
    const ahead = sampleAt(groundTop, rollHeight, rows + 0.01);
    const climb = Math.abs(here.groundY - here.rise - (ahead.groundY - ahead.rise)) * 100;
    rows += Math.min(STEP_ROWS, STEP_SCANLINES / Math.max(climb, 1e-3));
  }
  SAMPLES.set(key, samples);
  return samples;
}

/** A face tile as texels that keep their holes: a transparent texel is skipped, not black. */
export function faceTexels(grid: InkGrid): TileTexels {
  const rgba = new Uint8ClampedArray(grid.width * grid.height * 4);
  grid.inks.forEach((ink, index) => {
    if (ink !== null) {
      const colour = hexToRgb(INK_COLORS[ink]);
      rgba.set([colour.r, colour.g, colour.b, 255], index * 4);
    }
  });
  return { width: grid.width, rgba };
}

/**
 * Stand the lip's rock up, into `rgba`: `width` by `frame.groundTop`, row 0 at
 * the top of the screen, the lip's ground already in its bottom
 * `frame.rollHeight` rows. Rows above the horizon line are left as they are
 * wherever no rock rises into them.
 */
export function paintRollRock(
  frame: CameraFrame,
  width: number,
  rockAt: RockAt,
  haze: Rgb,
  rgba: Uint8ClampedArray,
): void {
  if (frame.rollHeight <= 0) {
    return;
  }
  const painter = new RockPainter(frame, width, rockAt, haze, rgba);
  for (let x = 0; x < width; x += 1) {
    painter.column(x);
  }
}

class RockPainter {
  private readonly samples: readonly RockSample[];
  /** Per sample: the world texel row it stands on, and the cell row that is. */
  private readonly texelRow: Int32Array;
  private readonly cellRow: Int32Array;
  /** Per sample: whether the lip owns that cell - its near edge is past the seam. */
  private readonly owned: Uint8Array;
  /** Per sample: texels per screen pixel across, and where screen x 0 lands in texels. */
  private readonly across: Float64Array;
  private readonly offset: Float64Array;
  /** Per sample: the top of a wall standing there, and the highest any wall at or past it reaches. */
  private readonly tops: Int32Array;
  private readonly highest: Int32Array;

  constructor(
    private readonly frame: CameraFrame,
    private readonly width: number,
    private readonly rockAt: RockAt,
    private readonly haze: Rgb,
    private readonly rgba: Uint8ClampedArray,
  ) {
    this.samples = rockSamples(frame.groundTop, frame.rollHeight);
    const shift = scrollOffset(frame);
    const seam = frame.footY + shift.y - frame.groundTop;
    const count = this.samples.length;
    this.texelRow = new Int32Array(count);
    this.cellRow = new Int32Array(count);
    this.owned = new Uint8Array(count);
    this.across = new Float64Array(count);
    this.offset = new Float64Array(count);
    this.tops = new Int32Array(count);
    this.highest = new Int32Array(count);
    this.samples.forEach((sample, index) => {
      const cellY = Math.floor(Math.floor(seam + sample.rowsBeyond * TILE_DEPTH) / TILE_DEPTH);
      // A cap pixel a step uncovers lies between this step and the last, so it
      // reads the ground halfway between them - the pixel's centre, not its edge.
      const before = this.samples[index - 1]?.rowsBeyond ?? sample.rowsBeyond;
      this.texelRow[index] = Math.floor(seam + ((before + sample.rowsBeyond) / 2) * TILE_DEPTH);
      this.cellRow[index] = cellY;
      this.owned[index] = cellY * TILE_DEPTH >= seam ? 1 : 0;
      // The lip's own convergence, as the ground pass has it: the texel under
      // screen x is (x + 0.5 - footX) / scale, slid by the scroll, from mid-cell.
      this.across[index] = 1 / sample.scale;
      this.offset[index] = (0.5 - frame.footX) / sample.scale - shift.x + TILE_WIDTH / 2;
      this.tops[index] = Math.round(sample.groundY - sample.rise);
    });
    let highest = frame.groundTop;
    for (let index = count - 1; index >= 0; index -= 1) {
      highest = Math.min(highest, this.tops[index] ?? highest);
      this.highest[index] = highest;
    }
  }

  /** March one screen column away from the seam, painting what stands. */
  column(x: number): void {
    let lowest = this.frame.groundTop;
    let standing = false;
    let lastCell = Number.NaN;
    let look: RockLook | null = null;
    const count = this.samples.length;
    // Stop once nothing at or past this sample can rise above what is painted.
    for (let index = 0; index < count && (this.highest[index] ?? 0) < lowest; index += 1) {
      const gx = Math.floor(x * (this.across[index] ?? 1) + (this.offset[index] ?? 0));
      const cellX = Math.floor(gx / TILE_WIDTH);
      const cellY = this.cellRow[index] ?? 0;
      const cell = (cellX + 0x8000) * 0x10000 + cellY;
      if (cell !== lastCell) {
        lastCell = cell;
        look = this.owned[index] === 1 ? this.rockAt(cellX, cellY) : null;
      }
      if (look === null) {
        standing = false;
        continue;
      }
      const top = this.tops[index] ?? lowest;
      if (top < lowest) {
        const u = gx - cellX * TILE_WIDTH;
        if (standing) {
          this.cap(x, top, lowest, index, look, u);
        } else {
          const sample = this.samples[index] as RockSample;
          this.face(x, top, Math.min(lowest, Math.round(sample.groundY)), sample, look, u);
        }
        lowest = top;
      }
      standing = true;
    }
  }

  /** The cap seen past the last scanline painted: one texel, the sample's own. */
  private cap(x: number, top: number, below: number, index: number, look: RockLook, u: number): void {
    const sample = this.samples[index] as RockSample;
    const cellY = this.cellRow[index] ?? 0;
    // Halfway back to the last step can fall a texel short of this cell's near edge.
    const v = Math.min(Math.max(TILE_DEPTH - 1 - ((this.texelRow[index] ?? 0) - cellY * TILE_DEPTH), 0), TILE_DEPTH - 1);
    for (let y = Math.max(top, 0); y < below; y += 1) {
      if (this.blurred(x, y, sample)) {
        this.putFar(x, y, sample, look.far?.cap ?? tileMode(look.cap));
      } else {
        this.putTexel(x, y, sample, look.cap, (v * look.cap.width + u) * 4);
      }
    }
  }

  /** The face, from the ground at the sample up to the wall's top, stretched by the rise. */
  private face(x: number, top: number, below: number, sample: RockSample, look: RockLook, u: number): void {
    for (let y = Math.max(top, 0); y < below; y += 1) {
      if (this.blurred(x, y, sample)) {
        this.putFar(x, y, sample, look.far?.face ?? tileMode(look.face));
        continue;
      }
      const tile = look.face;
      const rows = tile.rgba.length / 4 / tile.width;
      const up = (sample.groundY - y - 0.5) / Math.max(sample.rise, 1e-3);
      const row = Math.min(Math.max(rows - 1 - Math.floor(up * rows), 0), rows - 1);
      this.putTexel(x, y, sample, tile, (row * tile.width + u) * 4);
    }
  }

  /** Whether a pixel there spans too many texels to point-sample: the same dither the ground uses. */
  private blurred(x: number, y: number, sample: RockSample): boolean {
    const share = distantShare(sample.stride);
    return share > 0 && share > distantThreshold(x, y);
  }

  /** One pixel of rock from a texel - a hole in the art is left alone - then the air. */
  private putTexel(x: number, y: number, sample: RockSample, tile: TileTexels, from: number): void {
    if ((tile.rgba[from + 3] ?? 0) === 0) {
      return;
    }
    const at = (y * this.width + x) * 4;
    this.rgba[at] = tile.rgba[from] ?? 0;
    this.rgba[at + 1] = tile.rgba[from + 1] ?? 0;
    this.rgba[at + 2] = tile.rgba[from + 2] ?? 0;
    this.rgba[at + 3] = 255;
    hazeInto(this.rgba, at, this.haze, sample.fog, x, y);
  }

  /** One pixel of rock seen from too far to sample: its far colour, then the air. */
  private putFar(x: number, y: number, sample: RockSample, colour: number): void {
    const at = (y * this.width + x) * 4;
    writePacked(this.rgba, at, colour);
    hazeInto(this.rgba, at, this.haze, sample.fog, x, y);
  }
}
