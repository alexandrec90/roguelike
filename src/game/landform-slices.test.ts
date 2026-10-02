import { describe, expect, it } from "vitest";

import { createLandformPixels, NO_ROW, type LandformPixels } from "./landform-frame";
import { measureExtent, packSlices, SLICE_COLUMNS, sliceLandforms } from "./landform-slices";

/** A frame with land of `row` over the rectangle, coloured by its row. */
function paint(pixels: LandformPixels, row: number, left: number, top: number, right: number, bottom: number): void {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = y * pixels.width + x;
      pixels.rows[index] = row;
      pixels.rgba.set([row + 100, 50, 60, 255], index * 4);
    }
  }
}

describe("sliceLandforms", () => {
  it("cuts one slice per row and column chunk, each hugging its own pixels", () => {
    const pixels = createLandformPixels(80, 40);
    paint(pixels, 3, 2, 10, 20, 30);
    paint(pixels, -4, 40, 0, 70, 12);
    const { slices } = sliceLandforms(pixels);
    for (const slice of slices) {
      expect(Math.floor(slice.left / SLICE_COLUMNS)).toBe(Math.floor((slice.right - 1) / SLICE_COLUMNS));
      for (let y = slice.top; y < slice.bottom; y += 1) {
        let any = false;
        for (let x = slice.left; x < slice.right; x += 1) {
          any ||= pixels.rows[y * 80 + x] === slice.row;
        }
        expect(any).toBe(true);
      }
    }
    expect(new Set(slices.map((slice) => slice.row))).toEqual(new Set([3, -4]));
    const covered = slices.reduce((sum, slice) => sum + (slice.right - slice.left) * (slice.bottom - slice.top), 0);
    expect(covered).toBe(18 * 20 + 30 * 12);
  });

  it("packs the slices without overlap, inside an atlas as wide as the frame", () => {
    const pixels = createLandformPixels(96, 60);
    for (let row = 0; row < 12; row += 1) {
      paint(pixels, row, (row * 7) % 80, row * 4, (row * 7) % 80 + 14, row * 4 + 5);
    }
    const { slices, atlasHeight } = sliceLandforms(pixels);
    for (const a of slices) {
      expect(a.atlasX + a.right - a.left).toBeLessThanOrEqual(96);
      expect(a.atlasY + a.bottom - a.top).toBeLessThanOrEqual(atlasHeight);
      for (const b of slices) {
        if (a === b) {
          continue;
        }
        const apart =
          a.atlasX + a.right - a.left <= b.atlasX ||
          b.atlasX + b.right - b.left <= a.atlasX ||
          a.atlasY + a.bottom - a.top <= b.atlasY ||
          b.atlasY + b.bottom - b.top <= a.atlasY;
        expect(apart).toBe(true);
      }
    }
  });

  it("finds no slices in an empty frame", () => {
    expect(sliceLandforms(createLandformPixels(32, 8))).toEqual({ slices: [], atlasHeight: 0 });
  });
});

describe("packSlices", () => {
  it("copies each slice's own pixels, and none of the row in front of or behind it", () => {
    const pixels = createLandformPixels(40, 20);
    paint(pixels, 1, 0, 0, 20, 10);
    paint(pixels, 2, 5, 5, 15, 15);
    const { slices, atlasHeight } = sliceLandforms(pixels);
    const atlas = new Uint8ClampedArray(40 * atlasHeight * 4);
    packSlices(pixels, slices, atlas);
    for (const slice of slices) {
      for (let y = slice.top; y < slice.bottom; y += 1) {
        for (let x = slice.left; x < slice.right; x += 1) {
          const into = ((slice.atlasY + y - slice.top) * 40 + slice.atlasX + x - slice.left) * 4;
          const mine = pixels.rows[y * 40 + x] === slice.row;
          expect(atlas[into + 3]).toBe(mine ? 255 : 0);
          if (mine) {
            expect(atlas[into]).toBe(slice.row + 100);
          }
        }
      }
    }
  });
});

describe("measureExtent", () => {
  it("finds the band of scanlines holding land and its farthest row", () => {
    const pixels = createLandformPixels(10, 10);
    paint(pixels, 4, 0, 3, 2, 5);
    paint(pixels, -2, 5, 7, 6, 8);
    measureExtent(pixels);
    expect(pixels.extent).toEqual({ top: 3, bottom: 8, farthest: -2 });
    expect(pixels.rows[0]).toBe(NO_ROW);
  });
});
