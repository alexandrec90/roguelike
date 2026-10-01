/**
 * The grass on the horizon lip, as world texels laid over the ground tiles.
 *
 * The lip draws the field's own tufts (`roll-ground.ts`), and a tuft is a few
 * dozen pixels, two or three to a cell - so stamping them into a map afresh
 * every frame cost more than the rest of the lip several times over. They go
 * into this overlay instead: one typed RGBA buffer over the cells near the
 * seam, addressed by world texel, that remembers which cells it holds. It is
 * kept for as long as the ground pose holds; a frame re-stamps only the rows
 * whose blades sway (`forget`), and every other tuft is paid for once a step.
 *
 * Pure: no Phaser, no clock. The layer decides when to forget.
 */

import type { CameraFrame, LocalBounds } from "./camera";
import { hexToRgb } from "./color";
import { rollScale } from "./horizon";
import { INK_ALPHA, INK_COLORS, type PixelCloud } from "./ink";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";

/**
 * Rows past the seam over which the grass tufts are drawn on the lip.
 *
 * Past this a lip pixel spans a dozen texel rows and shows its tile's
 * commonest colour more often than not (`distantShare`), so a blade there
 * changes nothing anyone can see - while a scanline out there crosses a hundred
 * cells, and stamping their tufts was most of the cost of a frame of lip.
 */
export const TUFT_ROWS = 8;

/**
 * Every cell whose tufts the lip can show: a row short of the seam to a couple
 * past `TUFT_ROWS`, as wide as the screen is at the smallest scale out there,
 * with a cell to spare for a stride in flight and a blade leaning over an edge.
 */
export function tuftBounds(frame: CameraFrame, width: number): LocalBounds {
  const seam = (frame.footY - frame.groundTop) / TILE_DEPTH;
  const span = TILE_WIDTH * rollScale(TUFT_ROWS + 2, frame.rollHeight);
  return {
    minX: Math.floor(-frame.footX / span) - 3,
    maxX: Math.ceil((width - frame.footX) / span) + 3,
    minY: Math.floor(seam) - 2,
    maxY: Math.ceil(seam + TUFT_ROWS) + 3,
  };
}

/**
 * A cloud resolved once into numbers - x, y, r, g, b and alpha (0..255) per
 * pixel, six to a pixel - so stamping it is copying, with no ink to look up.
 * A tuft at a bend is the same picture every frame; resolve it once.
 */
export interface PackedCloud {
  readonly data: Int16Array;
}

export function packCloud(cloud: PixelCloud): PackedCloud {
  const data = new Int16Array(cloud.length * 6);
  cloud.forEach((pixel, index) => {
    const colour = hexToRgb(INK_COLORS[pixel.ink]);
    data.set([pixel.x, pixel.y, colour.r, colour.g, colour.b, Math.round(INK_ALPHA[pixel.ink] * 255)], index * 6);
  });
  return { data };
}

/** One tuft in a cell: its picture, and where its root is from the cell's foot. */
export interface TuftPiece {
  readonly cloud: PackedCloud;
  readonly x: number;
  readonly y: number;
}

/** Tuft pixels by world texel over a rectangle of cells; later stamps win. */
export class TuftOverlay {
  private readonly left: number;
  private readonly top: number;
  private readonly width: number;
  private readonly height: number;
  private readonly columns: number;
  private readonly rgba: Uint8ClampedArray;
  private readonly stamped: Uint8Array;

  constructor(readonly bounds: LocalBounds) {
    this.columns = Math.max(bounds.maxX - bounds.minX + 1, 0);
    const rows = Math.max(bounds.maxY - bounds.minY + 1, 0);
    this.left = bounds.minX * TILE_WIDTH;
    this.top = bounds.minY * TILE_DEPTH;
    this.width = this.columns * TILE_WIDTH;
    this.height = rows * TILE_DEPTH;
    this.rgba = new Uint8ClampedArray(this.width * this.height * 4);
    this.stamped = new Uint8Array(this.columns * rows);
  }

  /** True once a cell's tufts are in - and for any cell outside, which has none to give. */
  holds(cellX: number, cellY: number): boolean {
    const index = this.cellIndex(cellX, cellY);
    return index < 0 || this.stamped[index] === 1;
  }

  /**
   * Lay a cell's tufts in, in order. Each piece is anchored at the middle of
   * the cell's near edge - its foot - moved by the piece's `x`, `y`; a pixel's
   * row `y` from the foot lands on world texel row `cellY * TILE_DEPTH - y - 1`.
   */
  stamp(cellX: number, cellY: number, pieces: readonly TuftPiece[] | null): void {
    const index = this.cellIndex(cellX, cellY);
    if (index < 0) {
      return;
    }
    this.stamped[index] = 1;
    const footX = cellX * TILE_WIDTH + TILE_WIDTH / 2;
    const footY = cellY * TILE_DEPTH - 1;
    for (const piece of pieces ?? []) {
      const data = piece.cloud.data;
      for (let at = 0; at < data.length; at += 6) {
        const to = this.texelIndex(footX + piece.x + (data[at] ?? 0), footY - piece.y - (data[at + 1] ?? 0));
        if (to >= 0) {
          this.rgba[to] = data[at + 2] ?? 0;
          this.rgba[to + 1] = data[at + 3] ?? 0;
          this.rgba[to + 2] = data[at + 4] ?? 0;
          this.rgba[to + 3] = data[at + 5] ?? 0;
        }
      }
    }
  }

  /** Blend the grass at world texel (gx, gy), if any, over the pixel at byte `at`. */
  blendInto(gx: number, gy: number, target: Uint8ClampedArray, at: number): void {
    const from = this.texelIndex(gx, gy);
    const alpha = from < 0 ? 0 : (this.rgba[from + 3] ?? 0);
    if (alpha === 0) {
      return;
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const under = target[at + channel] ?? 0;
      target[at + channel] = under + (((this.rgba[from + channel] ?? 0) - under) * alpha) / 255;
    }
  }

  /**
   * Drop the tufts of cell rows `minY..maxY`, so the next frame stamps them at
   * their new bends. Their blades rise into the row beyond, so that row is
   * cleared too and its own tufts restamped - the same pixels, unchanged.
   */
  forget(minY: number, maxY: number): void {
    const from = Math.max(minY, this.bounds.minY);
    const to = Math.min(maxY + 1, this.bounds.maxY);
    if (to < from) {
      return;
    }
    this.stamped.fill(0, (from - this.bounds.minY) * this.columns, (to - this.bounds.minY + 1) * this.columns);
    const first = this.rowTexel(from);
    const last = this.rowTexel(to + 1);
    this.rgba.fill(0, first * this.width * 4, last * this.width * 4);
  }

  /** Drop everything: the pose moved and every cell reads another planet point. */
  reset(): void {
    this.stamped.fill(0);
    this.rgba.fill(0);
  }

  private cellIndex(cellX: number, cellY: number): number {
    const { minX, maxX, minY, maxY } = this.bounds;
    if (cellX < minX || cellX > maxX || cellY < minY || cellY > maxY) {
      return -1;
    }
    return (cellY - minY) * this.columns + (cellX - minX);
  }

  /** Buffer row of a cell row's nearest texels - rows run forward from `top`. */
  private rowTexel(cellY: number): number {
    return (cellY - this.bounds.minY) * TILE_DEPTH;
  }

  private texelIndex(gx: number, gy: number): number {
    const x = gx - this.left;
    const y = gy - this.top;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return -1;
    }
    return (y * this.width + x) * 4;
  }
}
