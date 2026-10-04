/**
 * Which screen pixels are water, as a flat byte grid.
 *
 * `puddleHolds` answers "is this pixel in *this* puddle" from a Set, which is
 * right for the geometry and too slow for a layer that clips every reflection,
 * glint and ring pixel against every puddle every frame. The mask answers "is
 * this pixel water, and whose" with one array read, and is rebuilt only when
 * the puddles are (once a step).
 *
 * It covers the render target plus a `margin` on every side, because water on
 * the zero-phase grid slides up to a tile before it is re-grown, and a puddle
 * just off the edge must already be in the mask when it scrolls on.
 */

import type { PixelCloud } from "../ink";
import type { Puddle } from "../puddles";

export interface WaterMask {
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  /** 0 is dry; `n` is the n-th puddle (1-based) of the last `fillMask`. */
  readonly cells: Uint8Array;
}

export function createMask(width: number, height: number, margin: number): WaterMask {
  const w = width + margin * 2;
  const h = height + margin * 2;
  return { width: w, height: h, margin, cells: new Uint8Array(w * h) };
}

/** Clear the mask and mark every pixel of every puddle. Coordinates are screen pixels. */
export function fillMask(mask: WaterMask, puddles: readonly Puddle[]): void {
  mask.cells.fill(0);
  puddles.forEach((puddle, index) => {
    const id = Math.min(index + 1, 255);
    const originX = puddle.centerX + mask.margin;
    const originY = puddle.centerY + mask.margin;
    // The shared outline, placed here: a lake's pixels are never laid out as objects.
    for (const { dx, dy } of puddle.offsets) {
      const x = Math.round(originX + dx);
      const y = Math.round(originY + dy);
      if (x >= 0 && y >= 0 && x < mask.width && y < mask.height) {
        mask.cells[y * mask.width + x] = id;
      }
    }
  });
}

/** Which puddle (1-based) holds a screen pixel; 0 for dry ground or off the mask. */
/**
 * The band of mask rows holding any water, `to` exclusive, or undefined for a
 * dry mask. Everything drawn on the water is clipped to it, so this bounds
 * what a frame of surface has to clear and upload.
 */
export function maskRows(mask: WaterMask): { readonly from: number; readonly to: number } | undefined {
  let from = -1;
  let to = -1;
  for (let y = 0; y < mask.height; y += 1) {
    const row = mask.cells.subarray(y * mask.width, (y + 1) * mask.width);
    if (row.some((cell) => cell !== 0)) {
      from = from < 0 ? y : from;
      to = y + 1;
    }
  }
  return from < 0 ? undefined : { from, to };
}

export function maskAt(mask: WaterMask, x: number, y: number): number {
  const mx = Math.round(x) + mask.margin;
  const my = Math.round(y) + mask.margin;
  if (mx < 0 || my < 0 || mx >= mask.width || my >= mask.height) {
    return 0;
  }
  return mask.cells[my * mask.width + mx] ?? 0;
}

/** Keep only what lies over water. */
export function clipToMask(mask: WaterMask, cloud: PixelCloud): PixelCloud {
  return cloud.filter((pixel) => maskAt(mask, pixel.x, pixel.y) !== 0);
}
