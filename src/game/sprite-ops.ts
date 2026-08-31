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

/**
 * Splice a grid of same-sized tiles into one sprite.
 *
 * The playfield is twenty columns by fifteen rows; drawing it as three hundred
 * images would cost three hundred quads a frame to render something that never
 * changes. Composing it once into a single texture costs one.
 *
 * Palettes are merged rather than re-keyed, and a token that means two
 * different colours across two tiles throws: silently letting the first
 * definition win would repaint half the field a shade nobody chose, and it
 * would do it only for the tiles that happened to be spliced second.
 */
export function composeTiles(
  columns: number,
  rows: number,
  pick: (column: number, row: number) => PixelSpriteSource,
): PixelSpriteSource {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) {
    throw new Error("Field size must be positive integers");
  }

  const palette: Record<string, string | null> = {};
  const cells: PixelSpriteSource[][] = [];

  for (let row = 0; row < rows; row += 1) {
    const line: PixelSpriteSource[] = [];
    for (let column = 0; column < columns; column += 1) {
      const tile = pick(column, row);
      mergePalette(palette, tile.palette, column, row);
      line.push(tile);
    }
    cells.push(line);
  }

  const first = cells[0]?.[0];
  if (first === undefined) {
    throw new Error("Field has no cells");
  }
  const cellHeight = first.rows.length;
  const cellWidth = first.rows[0]?.length ?? 0;

  const composed: string[] = [];
  cells.forEach((line, row) => {
    for (let y = 0; y < cellHeight; y += 1) {
      let text = "";
      line.forEach((tile, column) => {
        const source = tile.rows[y];
        if (source === undefined || tile.rows.length !== cellHeight || source.length !== cellWidth) {
          throw new Error(
            `Tile at ${column},${row} is ${tile.rows[0]?.length ?? 0}x${tile.rows.length}; ` +
              `the field is composed of ${cellWidth}x${cellHeight} cells`,
          );
        }
        text += source;
      });
      composed.push(text);
    }
  });

  return { palette, rows: composed };
}

function mergePalette(
  into: Record<string, string | null>,
  from: Palette,
  column: number,
  row: number,
): void {
  for (const [token, color] of Object.entries(from)) {
    const existing = into[token];
    if (existing !== undefined && existing !== color) {
      throw new Error(
        `Tile at ${column},${row} redefines palette token '${token}' as ${String(color)}; ` +
          `it is already ${String(existing)}`,
      );
    }
    into[token] = color ?? null;
  }
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
