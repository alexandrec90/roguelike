/**
 * A rectangle of inks: the ground's working format between "generated" and "on
 * the GPU".
 *
 * Tiles are generated as grids of named inks rather than as RGBA, for two
 * reasons. The lab needs them as text sprites (`gridToSprite`), which only an
 * ink can become; and every shade in a tile - a contact shadow, a crack, a lit
 * lip - is a step down or up a family ramp, so nothing about the ground ever
 * needs a colour that is not already an ink. The game resolves a grid to packed
 * RGBA exactly once, when it is first baked (`gridToPixels`), and afterwards
 * only copies those words around.
 */

import { hexToRgb } from "../color";
import { INK_ALPHA, INK_COLORS, INK_TOKENS, inkHex, type InkId } from "../ink";
import type { Palette, PixelSpriteSource } from "../pixel-art";

export interface InkGrid {
  readonly width: number;
  readonly height: number;
  /** Row-major; `null` is transparent. */
  readonly inks: (InkId | null)[];
}

export function createGrid(width: number, height: number, fill: InkId | null = null): InkGrid {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("An ink grid needs positive integer dimensions");
  }
  return { width, height, inks: new Array<InkId | null>(width * height).fill(fill) };
}

export function gridAt(grid: InkGrid, x: number, y: number): InkId | null {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) {
    return null;
  }
  return grid.inks[y * grid.width + x] ?? null;
}

export function setGrid(grid: InkGrid, x: number, y: number, ink: InkId | null): void {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) {
    return;
  }
  grid.inks[y * grid.width + x] = ink;
}

/** Copy `source` into `target` at (x, y); transparent source pixels leave the target alone. */
export function stampGrid(target: InkGrid, source: InkGrid, x: number, y: number): void {
  for (let row = 0; row < source.height; row += 1) {
    for (let column = 0; column < source.width; column += 1) {
      const ink = source.inks[row * source.width + column] ?? null;
      if (ink !== null) {
        setGrid(target, x + column, y + row, ink);
      }
    }
  }
}

/** The lab's format: one token per ink, `.` for transparent. */
export function gridToSprite(grid: InkGrid): PixelSpriteSource {
  const palette: Record<string, string | null> = { ".": null };
  const rows: string[] = [];
  for (let y = 0; y < grid.height; y += 1) {
    let row = "";
    for (let x = 0; x < grid.width; x += 1) {
      const ink = grid.inks[y * grid.width + x] ?? null;
      if (ink === null) {
        row += ".";
        continue;
      }
      const token = INK_TOKENS[ink];
      palette[token] = inkHex(ink);
      row += token;
    }
    rows.push(row);
  }
  return { palette: palette as Palette, rows };
}

/** Packed little-endian RGBA per ink, resolved once. */
const PACKED = new Map<InkId, number>();

/** An ink as one `Uint32` in the byte order a canvas `ImageData` uses on little-endian hosts. */
export function packedInk(ink: InkId): number {
  let word = PACKED.get(ink);
  if (word === undefined) {
    const { r, g, b } = hexToRgb(INK_COLORS[ink]);
    const a = Math.round(Math.min(Math.max(INK_ALPHA[ink], 0), 1) * 255);
    word = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    PACKED.set(ink, word);
  }
  return word;
}

/** The grid as packed RGBA words, row-major - what a blit copies. */
export function gridToPixels(grid: InkGrid): Uint32Array {
  const words = new Uint32Array(grid.width * grid.height);
  for (let index = 0; index < words.length; index += 1) {
    const ink = grid.inks[index] ?? null;
    words[index] = ink === null ? 0 : packedInk(ink);
  }
  return words;
}
