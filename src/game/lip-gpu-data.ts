/**
 * What the horizon lip's shader is handed, built on the CPU: pure, and renderer
 * free, so every table is tested here and the shader only reads them.
 *
 * The lip used to be painted in JavaScript, pixel by pixel - 320 x 24 pixels,
 * each a tile texel, the water over it, the grass over that and the air's haze,
 * at ~2 ms a frame because every one of them went through a closure, a map and
 * a bounds check. `gpu/lip-shader.ts` makes the same picture from these:
 *
 * - **the lines** - per scanline, the world texel row it shows, how wide a
 *   pixel is there, the haze and the share of far pixels (`lineTable`);
 * - **the pages** - 16 x 12 pictures in one atlas, each a ground tile or a
 *   cell's worth of puddle, allocated least recently used first (`PageAtlas`);
 * - **the cells** - per lip cell, which tile page, which terrain's far look,
 *   which puddle page (`CellTable`);
 * - **the far looks** - per terrain code, its `FAR_LEVELS` colours in their
 *   shares (`farLookTexels`);
 * - **the tufts** - up to three per cell near the seam, as a frame of the tuft
 *   atlas and a root (`TuftTable`, `tuftAtlas`).
 *
 * `roll-ground.ts` stays the reference: the CPU path, the tests, and what the
 * shader is diffed against in the running page.
 */

import { scrollOffset, type CameraFrame, type LocalBounds } from "./camera";
import { BEND_LEVELS, TUFT_FRAME, TUFT_SHAPES, tuftCloud } from "./ground/tufts";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import { FAR_LEVELS, type FarLook } from "./roll-far";
import { distantShare, rollScanlines, type RollScanline, type TileTexels } from "./roll-ground";
import { packCloud, TUFT_ROWS } from "./roll-grass";

/** Scanlines the line table has room for: the lip is two dozen at the default split. */
export const MAX_LINES = 128;

/** Up to three tufts root in a cell (`tuft-placement.ts`). */
export const TUFTS_PER_CELL = 3;

const SCANLINES = new Map<string, readonly RollScanline[]>();

/** `rollScanlines`, once per layout: the curve does not move with the stride, only the scroll does. */
function scanlinesFor(frame: CameraFrame): readonly RollScanline[] {
  const key = `${frame.rollHeight}|${frame.groundTop}`;
  let lines = SCANLINES.get(key);
  if (lines === undefined) {
    lines = rollScanlines({ ...frame, phaseX: 0, phaseY: 0 });
    SCANLINES.set(key, lines);
  }
  return lines;
}

/** One scanline as the shader reads it, and as the cell pass walks it. */
export interface LipLine {
  /** World texel row, scroll included. */
  readonly gy: number;
  /** Texels per screen pixel across: `1 / scale`. */
  readonly invScale: number;
  readonly fog: number;
  /** Share of pixels that show their cell's far look; 0 is none, 1 is all. */
  readonly distant: number;
  readonly tufted: boolean;
  /** Screen y, for the dither. */
  readonly y: number;
}

/**
 * Every scanline of the lip for this frame, top first - the same `gy` and
 * scale `rollGroundPixels` computes, scroll and all.
 */
export function lipLines(frame: CameraFrame, shift = scrollOffset(frame)): LipLine[] {
  const seam = (frame.footY + shift.y - frame.groundTop) / TILE_DEPTH;
  return scanlinesFor(frame).map((line) => ({
    gy: Math.floor((seam + line.rowsBeyond) * TILE_DEPTH),
    invScale: 1 / line.scale,
    fog: line.fog,
    distant: distantShare(line.stride),
    tufted: line.rowsBeyond <= TUFT_ROWS,
    y: line.y,
  }));
}

/** The world texel column screen pixel `x` reads on a line: `rollGroundPixels`' own sum. */
export function texelColumn(x: number, line: LipLine, frame: CameraFrame, shiftX: number): number {
  return Math.floor((x + 0.5 - frame.footX) * line.invScale + TILE_WIDTH / 2) - shiftX;
}

/**
 * The lines packed for a `MAX_LINES` x 2 float texture: row 0 is
 * `(gy, invScale, fog, distant)`, row 1 is `(tufted, y, 0, 0)`.
 */
export function lineTable(lines: readonly LipLine[]): Float32Array {
  const data = new Float32Array(MAX_LINES * 2 * 4);
  lines.slice(0, MAX_LINES).forEach((line, index) => {
    data.set([line.gy, line.invScale, line.fog, line.distant], index * 4);
    data.set([line.tufted ? 1 : 0, line.y, 0, 0], (MAX_LINES + index) * 4);
  });
  return data;
}

/** What a cell must have for a frame of lip: its tile, its far colour, its tufts. */
export const NEEDS_TILE = 1;
export const NEEDS_FAR = 2;
export const NEEDS_TUFTS = 4;

/**
 * Every cell the lip reads, with what it reads of it, for any scroll in
 * `shiftsX` x `shiftsY` - one scroll for the frame on screen, the whole range
 * a stride can reach for an anchor being prepared ahead.
 *
 * A point-sampled pixel needs its cell's tile, and if it is tufted the tufts
 * of every cell whose blades can reach it - its own row and the nearer one, a
 * column either side (`TUFT_REACH` in `roll-ground.ts`). A far pixel needs the
 * far colour. Water is asked of every cell either way, by the caller.
 * `range` limits the walk to a band of scanlines, top first, for preparing an
 * anchor a share at a time.
 */
export function visitLipCells(
  frame: CameraFrame,
  width: number,
  shifts: { readonly x: readonly number[]; readonly y: readonly number[] },
  visit: (cellX: number, cellY: number, needs: number) => void,
  range: { readonly from: number; readonly to: number } = { from: 0, to: Number.POSITIVE_INFINITY },
): void {
  const rows = new Map<number, { minX: number; maxX: number; needs: number }>();
  const mark = (cellY: number, minX: number, maxX: number, needs: number): void => {
    const row = rows.get(cellY);
    if (row === undefined) {
      rows.set(cellY, { minX, maxX, needs });
      return;
    }
    row.minX = Math.min(row.minX, minX);
    row.maxX = Math.max(row.maxX, maxX);
    row.needs |= needs;
  };
  for (const shiftY of shifts.y) {
    const lines = lipLines(frame, { x: 0, y: shiftY }).slice(range.from, range.to);
    for (const line of lines) {
      const cellY = Math.floor(line.gy / TILE_DEPTH);
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      for (const shiftX of shifts.x) {
        minX = Math.min(minX, Math.floor(texelColumn(0, line, frame, shiftX) / TILE_WIDTH));
        maxX = Math.max(maxX, Math.floor(texelColumn(width - 1, line, frame, shiftX) / TILE_WIDTH));
      }
      const near = line.distant < 1;
      mark(cellY, minX, maxX, (near ? NEEDS_TILE : 0) | (line.distant > 0 ? NEEDS_FAR : 0));
      if (near && line.tufted) {
        mark(cellY, minX - 1, maxX + 1, NEEDS_TUFTS);
        mark(cellY - 1, minX - 1, maxX + 1, NEEDS_TUFTS);
      }
    }
  }
  for (const [cellY, row] of rows) {
    for (let cellX = row.minX; cellX <= row.maxX; cellX += 1) {
      visit(cellX, cellY, row.needs);
    }
  }
}

/**
 * What filling a cell costs, roughly, in units of reading one far colour: a
 * tile composes from the lattice round it (~30 us on the HD 530 machine), a
 * tuft row lays in a few placements.
 */
const CELL_COST = { base: 1, tile: 24, tufts: 4 } as const;

/** Cost a warm task may carry: a dozen or so tiles, about half a millisecond. */
export const WARM_TASK_COST = 320;

/**
 * Cells cut into tasks of at most `WARM_TASK_COST` each, in order - so no one
 * frame that prepares an anchor ahead carries a hundred tiles of it. A single
 * cell over the limit is a task of its own.
 */
export function warmChunks<T extends readonly [number, number, number]>(cells: readonly T[], limit = WARM_TASK_COST): T[][] {
  const chunks: T[][] = [];
  let chunk: T[] = [];
  let cost = 0;
  for (const cell of cells) {
    const needs = cell[2];
    const weight =
      CELL_COST.base + ((needs & NEEDS_TILE) !== 0 ? CELL_COST.tile : 0) + ((needs & NEEDS_TUFTS) !== 0 ? CELL_COST.tufts : 0);
    if (chunk.length > 0 && cost + weight > limit) {
      chunks.push(chunk);
      chunk = [];
      cost = 0;
    }
    chunk.push(cell);
    cost += weight;
  }
  if (chunk.length > 0) {
    chunks.push(chunk);
  }
  return chunks;
}

/** Every scroll a stride in flight can put on the screen: under a tile each way. */
export const STRIDE_SHIFTS = {
  x: [-TILE_WIDTH, 0, TILE_WIDTH],
  y: [-TILE_DEPTH, 0, TILE_DEPTH],
} as const;

/**
 * 16 x 12 pictures in one RGBA byte atlas, kept least recently used first.
 *
 * A page is asked for by a key - a tile's texels, a puddle cell - and filled
 * once; asking again marks it used. The atlas mirrors itself on the CPU and
 * reports the band of texel rows changed since it was last uploaded.
 */
export class PageAtlas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array<ArrayBuffer>;
  private readonly columns: number;
  private readonly capacity: number;
  private readonly slots = new Map<unknown, number>();
  private readonly owners: unknown[] = [];
  private readonly used: number[] = [];
  private clock = 0;
  private dirtyFrom = Number.POSITIVE_INFINITY;
  private dirtyTo = Number.NEGATIVE_INFINITY;

  constructor(columns: number, rows: number) {
    this.columns = columns;
    this.capacity = columns * rows;
    this.width = columns * TILE_WIDTH;
    this.height = rows * TILE_DEPTH;
    this.data = new Uint8Array(new ArrayBuffer(this.width * this.height * 4));
  }

  /** Start a frame: pages asked for from now on count as this frame's. */
  tick(): void {
    this.clock += 1;
  }

  /**
   * The slot holding `key`, filling it with `fill` - handed the atlas bytes,
   * the byte offset of the page's top-left and the atlas row stride - if it is
   * not in yet. Slot 0 is never handed out: a cell stores `slot` and 0 means none.
   */
  slotFor(key: unknown, fill: (data: Uint8Array, at: number, stride: number) => void): number {
    const known = this.slots.get(key);
    if (known !== undefined) {
      this.used[known] = this.clock;
      return known;
    }
    const slot = this.freeSlot();
    const previous = this.owners[slot];
    if (previous !== undefined) {
      this.slots.delete(previous);
    }
    this.owners[slot] = key;
    this.used[slot] = this.clock;
    this.slots.set(key, slot);
    const { x, y } = this.origin(slot);
    const stride = this.width * 4;
    for (let row = 0; row < TILE_DEPTH; row += 1) {
      this.data.fill(0, (y + row) * stride + x * 4, (y + row) * stride + (x + TILE_WIDTH) * 4);
    }
    fill(this.data, y * stride + x * 4, stride);
    this.dirtyFrom = Math.min(this.dirtyFrom, y);
    this.dirtyTo = Math.max(this.dirtyTo, y + TILE_DEPTH);
    return slot;
  }

  /** Where a slot's page starts, in atlas texels. */
  origin(slot: number): { readonly x: number; readonly y: number } {
    return { x: (slot % this.columns) * TILE_WIDTH, y: Math.floor(slot / this.columns) * TILE_DEPTH };
  }

  /** The texel rows changed since the last call, `to` exclusive, or undefined if none. */
  takeDirty(): { readonly from: number; readonly to: number } | undefined {
    if (this.dirtyTo < this.dirtyFrom) {
      return undefined;
    }
    const band = { from: this.dirtyFrom, to: this.dirtyTo };
    this.dirtyFrom = Number.POSITIVE_INFINITY;
    this.dirtyTo = Number.NEGATIVE_INFINITY;
    return band;
  }

  /** The first slot never used, else the least recently used one not asked for this frame. */
  private freeSlot(): number {
    if (this.owners.length < this.capacity) {
      return Math.max(this.owners.length, 1);
    }
    let best = -1;
    let oldest = Number.POSITIVE_INFINITY;
    for (let slot = 1; slot < this.capacity; slot += 1) {
      const used = this.used[slot] ?? 0;
      if (used < oldest && used !== this.clock) {
        best = slot;
        oldest = used;
      }
    }
    if (best < 0) {
      throw new Error("PageAtlas is full of pages used this frame");
    }
    return best;
  }
}

/** Copy a ground tile into a page, rows as the tile has them (far edge first). */
export function tilePage(tile: TileTexels, data: Uint8Array, at: number, stride: number): void {
  for (let row = 0; row < TILE_DEPTH; row += 1) {
    data.set(tile.rgba.subarray(row * tile.width * 4, row * tile.width * 4 + TILE_WIDTH * 4), at + row * stride);
  }
}

/**
 * `farSlot` in integers, as the shader takes it: the slot is the top bits of
 * the 32-bit pixel hash, `FAR_LEVELS` being a power of two.
 */
export const FAR_SLOT_SHIFT = 32 - Math.log2(FAR_LEVELS);

/**
 * The far looks as the shader reads them: one row of `FAR_LEVELS` RGBA bytes
 * per terrain code, in code order, so slot `farSlot(x, y)` of a cell's code is
 * the texel at (slot, code).
 */
export function farLookTexels(looks: readonly FarLook[]): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(FAR_LEVELS * looks.length * 4);
  looks.forEach((look, code) => {
    for (let slot = 0; slot < FAR_LEVELS; slot += 1) {
      const colour = look.table[slot] ?? 0;
      const at = (code * FAR_LEVELS + slot) * 4;
      data[at] = (colour >> 16) & 0xff;
      data[at + 1] = (colour >> 8) & 0xff;
      data[at + 2] = colour & 0xff;
      data[at + 3] = 255;
    }
  });
  return data;
}

/**
 * Per lip cell, four floats: tile slot, far terrain code + 1, puddle slot, and
 * whether the cell has been filled - 0 in each for nothing.
 */
export class CellTable {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
  dirty = true;

  constructor(readonly bounds: LocalBounds) {
    this.width = Math.max(bounds.maxX - bounds.minX + 1, 1);
    this.height = Math.max(bounds.maxY - bounds.minY + 1, 1);
    this.data = new Float32Array(this.width * this.height * 4);
  }

  /** Byte index of a cell's texel, or -1 outside the table. */
  index(cellX: number, cellY: number): number {
    const x = cellX - this.bounds.minX;
    const y = cellY - this.bounds.minY;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return -1;
    }
    return (y * this.width + x) * 4;
  }

  /** Set one channel of a cell, marking the table for upload if it changed. */
  set(cellX: number, cellY: number, channel: number, value: number): void {
    const at = this.index(cellX, cellY);
    if (at >= 0 && this.data[at + channel] !== value) {
      this.data[at + channel] = value;
      this.dirty = true;
    }
  }

  get(cellX: number, cellY: number, channel: number): number {
    const at = this.index(cellX, cellY);
    return at < 0 ? 0 : (this.data[at + channel] ?? 0);
  }
}

/** One tuft as the table holds it: a frame of the tuft atlas, and its root in the cell. */
export interface TuftEntry {
  readonly frame: number;
  readonly dx: number;
  readonly dy: number;
}

/**
 * Per cell of the grass bounds, `TUFTS_PER_CELL` texels of
 * `(frame + 1, dx, dy, 0)` - 0 in the first for no tuft - and which rows
 * changed since the last upload.
 */
export class TuftTable {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
  /** Per cell, whether its tufts have been laid in. */
  private readonly filled: Uint8Array;
  private dirtyFrom = Number.POSITIVE_INFINITY;
  private dirtyTo = Number.NEGATIVE_INFINITY;

  constructor(readonly bounds: LocalBounds) {
    this.width = Math.max(bounds.maxX - bounds.minX + 1, 1) * TUFTS_PER_CELL;
    this.height = Math.max(bounds.maxY - bounds.minY + 1, 1);
    this.data = new Float32Array(this.width * this.height * 4);
    this.filled = new Uint8Array((this.width / TUFTS_PER_CELL) * this.height);
  }

  contains(cellX: number, cellY: number): boolean {
    const { minX, maxX, minY, maxY } = this.bounds;
    return cellX >= minX && cellX <= maxX && cellY >= minY && cellY <= maxY;
  }

  /** Whether a cell's tufts are in: an upright row need not be laid in again. */
  has(cellX: number, cellY: number): boolean {
    return this.contains(cellX, cellY) && this.filled[this.cellIndex(cellX, cellY)] === 1;
  }

  /** Lay a cell's tufts in, at most `TUFTS_PER_CELL`; the rest of its slots are emptied. */
  set(cellX: number, cellY: number, tufts: readonly TuftEntry[]): void {
    if (!this.contains(cellX, cellY)) {
      return;
    }
    this.filled[this.cellIndex(cellX, cellY)] = 1;
    const row = cellY - this.bounds.minY;
    const base = (row * this.width + (cellX - this.bounds.minX) * TUFTS_PER_CELL) * 4;
    let changed = false;
    for (let index = 0; index < TUFTS_PER_CELL; index += 1) {
      const tuft = tufts[index];
      const values = tuft === undefined ? [0, 0, 0, 0] : [tuft.frame + 1, tuft.dx, tuft.dy, 0];
      for (let channel = 0; channel < 4; channel += 1) {
        const at = base + index * 4 + channel;
        if (this.data[at] !== values[channel]) {
          this.data[at] = values[channel] ?? 0;
          changed = true;
        }
      }
    }
    if (changed) {
      this.dirtyFrom = Math.min(this.dirtyFrom, row);
      this.dirtyTo = Math.max(this.dirtyTo, row + 1);
    }
  }

  /** The table rows changed since the last call, `to` exclusive, or undefined. */
  takeDirty(): { readonly from: number; readonly to: number } | undefined {
    if (this.dirtyTo < this.dirtyFrom) {
      return undefined;
    }
    const band = { from: this.dirtyFrom, to: this.dirtyTo };
    this.dirtyFrom = Number.POSITIVE_INFINITY;
    this.dirtyTo = Number.NEGATIVE_INFINITY;
    return band;
  }

  /** Every row changed: the table is new to the GPU. */
  markAll(): void {
    this.dirtyFrom = 0;
    this.dirtyTo = this.height;
  }

  private cellIndex(cellX: number, cellY: number): number {
    return (cellY - this.bounds.minY) * (this.width / TUFTS_PER_CELL) + (cellX - this.bounds.minX);
  }
}

/** A tuft at a bend as a frame of `tuftAtlas`: shapes down, bends across. */
export function tuftAtlasFrame(shape: number, bend: number): number {
  return shape * BEND_LEVELS + bend;
}

/**
 * Every tuft shape at every bend the lip draws, as RGBA bytes in one atlas:
 * `TUFT_FRAME`-sized boxes, root at the box's origin, pixels laid in cloud
 * order with no blending - exactly what `TuftOverlay.stamp` writes, so a
 * later pixel of a tuft replaces an earlier one as it does there.
 */
export function tuftAtlas(): { readonly width: number; readonly height: number; readonly data: Uint8Array<ArrayBuffer> } {
  const width = TUFT_FRAME.width * BEND_LEVELS;
  const height = TUFT_FRAME.height * TUFT_SHAPES.length;
  const data = new Uint8Array(new ArrayBuffer(width * height * 4));
  TUFT_SHAPES.forEach((shape, shapeIndex) => {
    for (let bend = 0; bend < BEND_LEVELS; bend += 1) {
      const packed = packCloud(tuftCloud(shape, bend)).data;
      for (let at = 0; at < packed.length; at += 6) {
        const u = TUFT_FRAME.originX + (packed[at] ?? 0);
        const v = TUFT_FRAME.originY + (packed[at + 1] ?? 0);
        if (u < 0 || v < 0 || u >= TUFT_FRAME.width || v >= TUFT_FRAME.height) {
          continue;
        }
        const to = ((shapeIndex * TUFT_FRAME.height + v) * width + bend * TUFT_FRAME.width + u) * 4;
        data.set([packed[at + 2] ?? 0, packed[at + 3] ?? 0, packed[at + 4] ?? 0, packed[at + 5] ?? 0], to);
      }
    }
  });
  return { width, height, data };
}
