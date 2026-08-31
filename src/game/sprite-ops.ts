/**
 * Pure transforms over authored pixel sources.
 *
 * `pixel-art.ts` turns a source into pixels; this module reshapes the source
 * before that happens. Keeping the two apart matters for the asset lab: a
 * palette swap or a tiled preview must be describable as data so it can be
 * asserted in a test, not only judged by eye in the browser.
 */

import type { Palette, PixelSpriteSource } from "./pixel-art";

export interface ContentBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Bounds of a source that draws nothing at all. */
export const EMPTY_BOUNDS: ContentBounds = { left: 0, top: 0, width: 0, height: 0 };

/**
 * Re-colour a sprite without touching its silhouette.
 *
 * Every override key must already exist in the source palette. A typo would
 * otherwise be a silent no-op — the sprite renders in its authored colours and
 * the variant looks "not applied" for reasons nothing reports.
 */
export function swapPalette(source: PixelSpriteSource, overrides: Palette): PixelSpriteSource {
  const unknown = Object.keys(overrides).filter((token) => !(token in source.palette));
  if (unknown.length > 0) {
    throw new Error(`Palette swap targets tokens the sprite does not use: ${unknown.join(", ")}`);
  }

  return { palette: { ...source.palette, ...overrides }, rows: source.rows };
}

/**
 * Smallest rectangle containing every non-transparent pixel.
 *
 * The lab draws this as a guide: art authored on a 16x16 canvas but sitting
 * three pixels off its baseline reads as fine in isolation and misaligns the
 * moment it stands next to a tile.
 */
export function contentBounds(source: PixelSpriteSource): ContentBounds {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  source.rows.forEach((row, y) => {
    Array.from(row).forEach((token, x) => {
      if (!isOpaqueToken(source.palette, token)) {
        return;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    });
  });

  if (right < left || bottom < top) {
    return EMPTY_BOUNDS;
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Repeat a source into a `columns x rows` sheet.
 *
 * This is how the lab shows tile seams: a wall that looks correct alone but
 * grows a bright line every 16 pixels when repeated is only visible tiled.
 */
export function repeatSprite(
  source: PixelSpriteSource,
  columns: number,
  rows: number,
): PixelSpriteSource {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) {
    throw new Error("Repeat counts must be positive integers");
  }

  const repeated: string[] = [];
  for (let copy = 0; copy < rows; copy += 1) {
    for (const row of source.rows) {
      repeated.push(row.repeat(columns));
    }
  }

  return { palette: source.palette, rows: repeated };
}

function isOpaqueToken(palette: Palette, token: string): boolean {
  const color = palette[token];
  if (color === undefined) {
    throw new Error(`Unknown palette token '${token}'`);
  }
  if (color === null) {
    return false;
  }
  return color.length !== 9 || color.slice(7, 9).toLowerCase() !== "00";
}
