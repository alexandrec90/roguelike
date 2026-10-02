/**
 * Cutting a frame of landforms into depth slices.
 *
 * A landform is far bigger than a tree, and the hero walks right up to it: a
 * single image sorted at one depth would draw a whole mountain in front of a
 * tree behind its far shoulder, or behind the hero standing at its foot. So
 * each landform pixel carries the affine row of the surface it shows
 * (`landform-render.ts`), and the frame is cut into one slice per row - each
 * sorted at that row's depth, among the trees and actors standing on the same
 * row. Occlusion is then exactly as fine as it is for everything else here: a
 * row. (A row is cut again into `SLICE_COLUMNS`-wide chunks, which changes
 * nothing about the order and keeps each slice's rectangle tight.)
 *
 * The slices are packed into one atlas on shelves, tallest first - a far row's
 * slice is a few pixels each way, a near one most of the screen wide - and the
 * layer draws the atlas through one image per slice, cropped to the slice's
 * rectangle and shifted back to where it came from.
 *
 * Pure: pixels in, rectangles and atlas pixels out.
 */

import { NO_ROW, type LandformPixels } from "./landform-frame";

export interface LandformSlice {
  /** The affine row every pixel in it stands on. */
  readonly row: number;
  /** Its rectangle on the screen, inclusive-exclusive. */
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  /** Where its top-left pixel is in the atlas. */
  readonly atlasX: number;
  readonly atlasY: number;
}

/**
 * Columns per slice. A row of a big mountain shows low on one flank and high
 * at the peak, so one rectangle per row would span the screen's height and the
 * atlas would be mostly air; cut every row into column chunks and each slice
 * hugs the band of land it holds.
 */
export const SLICE_COLUMNS = 32;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The slices of a frame, and how tall an atlas they pack into. */
export function sliceLandforms(pixels: LandformPixels): { slices: LandformSlice[]; atlasHeight: number } {
  const { width, rows, extent } = pixels;
  if (extent.farthest === NO_ROW) {
    measureExtent(pixels);
  }
  const chunks = Math.ceil(width / SLICE_COLUMNS);
  // Boxes by (row, chunk), in an array offset by the farthest row there is.
  const farthest = extent.farthest;
  const boxes: (Box | undefined)[] = [];
  for (let y = extent.top; y < extent.bottom; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const row = rows[y * width + x] ?? NO_ROW;
      if (row === NO_ROW) {
        continue;
      }
      const key = (row - farthest) * chunks + Math.floor(x / SLICE_COLUMNS);
      const box = boxes[key];
      if (box === undefined) {
        boxes[key] = { left: x, right: x + 1, top: y, bottom: y + 1 };
      } else {
        box.left = Math.min(box.left, x);
        box.right = Math.max(box.right, x + 1);
        box.bottom = y + 1;
      }
    }
  }
  const found: [number, Box][] = [];
  boxes.forEach((box, key) => {
    if (box !== undefined) {
      found.push([Math.floor(key / chunks) + farthest, box]);
    }
  });
  return shelve(found, width);
}

/** Find the band of scanlines holding land, and its farthest row, for pixels no merge has measured. */
export function measureExtent(pixels: LandformPixels): void {
  const extent = pixels.extent;
  extent.top = pixels.height;
  extent.bottom = 0;
  extent.farthest = Number.MAX_SAFE_INTEGER;
  for (let y = 0; y < pixels.height; y += 1) {
    for (let x = 0; x < pixels.width; x += 1) {
      const row = pixels.rows[y * pixels.width + x] ?? NO_ROW;
      if (row !== NO_ROW) {
        extent.top = Math.min(extent.top, y);
        extent.bottom = y + 1;
        extent.farthest = Math.min(extent.farthest, row);
      }
    }
  }
}

/** Pack boxes into an atlas `width` across on shelves, tallest first. */
function shelve(found: [number, Box][], width: number): { slices: LandformSlice[]; atlasHeight: number } {
  const slices: LandformSlice[] = [];
  let shelfX = 0;
  let shelfY = 0;
  let shelfHeight = 0;
  found.sort((a, b) => b[1].bottom - b[1].top - (a[1].bottom - a[1].top) || a[0] - b[0]);
  for (const [row, box] of found) {
    const boxWidth = box.right - box.left;
    if (shelfX + boxWidth > width) {
      shelfY += shelfHeight;
      shelfX = 0;
      shelfHeight = 0;
    }
    slices.push({ row, ...box, atlasX: shelfX, atlasY: shelfY });
    shelfX += boxWidth;
    shelfHeight = Math.max(shelfHeight, box.bottom - box.top);
  }
  return { slices, atlasHeight: shelfY + shelfHeight };
}

/**
 * Copy each slice's own pixels to its place in the atlas - as wide as the frame -
 * leaving everything else in its rectangle transparent, so a slice never
 * carries a pixel of the row in front of or behind it.
 */
export function packSlices(pixels: LandformPixels, slices: readonly LandformSlice[], atlas: Uint8ClampedArray): void {
  const used = slices.reduce((most, slice) => Math.max(most, slice.atlasY + slice.bottom - slice.top), 0);
  atlas.fill(0, 0, Math.min(atlas.length, used * pixels.width * 4));
  for (const slice of slices) {
    for (let y = slice.top; y < slice.bottom; y += 1) {
      const into = (slice.atlasY + y - slice.top) * pixels.width + slice.atlasX - slice.left;
      for (let x = slice.left; x < slice.right; x += 1) {
        if (pixels.rows[y * pixels.width + x] !== slice.row) {
          continue;
        }
        const from = (y * pixels.width + x) * 4;
        const to = (into + x) * 4;
        atlas[to] = pixels.rgba[from] ?? 0;
        atlas[to + 1] = pixels.rgba[from + 1] ?? 0;
        atlas[to + 2] = pixels.rgba[from + 2] ?? 0;
        atlas[to + 3] = pixels.rgba[from + 3] ?? 0;
      }
    }
  }
}
