/**
 * The sample outdoor scene: one authored map, read by everything that draws it.
 *
 * The map is text for the same reason the sprites are — it diffs, and a
 * reviewer can see the path move. One character per world cell, row 0 at the
 * horizon and the last row at the near edge of the screen:
 *
 *     '.'  grass
 *     ','  trodden dirt path
 *     '#'  rock block, one wall unit tall
 *
 * The map is anchored at the horizon, so changing the horizon split adds or
 * drops a row at the *near* edge rather than sliding the whole composition.
 * Cells outside the map are grass, which is what makes that safe.
 */

import type { PixelSpriteSource } from "./pixel-art";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import { composeTiles } from "./sprite-ops";
import { DIRT_PATH, GRASS, WALL_TOP } from "./tiles";

export type Terrain = "grass" | "dirt" | "rock";

export const FIELD_MAP: readonly string[] = [
  "....,,,.............",
  "....,,,.............",
  "....,,,.......###...",
  ".....,,,......###...",
  ".....,,,......###...",
  "......,,,...........",
  "..###.,,,...........",
  "..###..,,,..........",
  "..###..,,,..........",
  "........,,,.........",
  "........,,,.........",
  ".........,,,........",
  ".........,,,........",
  ".........,,,........",
  "..........,,,.......",
];

const TERRAIN_BY_GLYPH: Readonly<Record<string, Terrain>> = {
  ".": "grass",
  ",": "dirt",
  "#": "rock",
};

const GROUND_SOURCE: Readonly<Record<Terrain, PixelSpriteSource>> = {
  grass: GRASS,
  dirt: DIRT_PATH,
  rock: WALL_TOP,
};

export interface Cell {
  readonly column: number;
  readonly row: number;
}

/** Grass outside the map: the field is bigger than the scene drawn on it. */
export function terrainAt(
  column: number,
  row: number,
  map: readonly string[] = FIELD_MAP,
): Terrain {
  const glyph = map[row]?.[column];
  if (glyph === undefined) {
    return "grass";
  }
  const terrain = TERRAIN_BY_GLYPH[glyph];
  if (terrain === undefined) {
    throw new Error(`Unknown terrain glyph '${glyph}' at ${column},${row}`);
  }
  return terrain;
}

export function isRock(column: number, row: number, map: readonly string[] = FIELD_MAP): boolean {
  return terrainAt(column, row, map) === "rock";
}

/**
 * The rock cells whose front face the camera can see.
 *
 * A block with another block directly in front of it shows no face — the near
 * block's cap covers exactly the strip it would occupy — so drawing one anyway
 * would put a course of mortar in the middle of a flat rock shelf.
 */
export function faceCells(
  columns: number,
  rows: number,
  map: readonly string[] = FIELD_MAP,
): readonly Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (isRock(column, row, map) && !isRock(column, row + 1, map)) {
        cells.push({ column, row });
      }
    }
  }
  return cells;
}

/** Every rock cell in the visible field, far row first. */
export function rockCells(
  columns: number,
  rows: number,
  map: readonly string[] = FIELD_MAP,
): readonly Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (isRock(column, row, map)) {
        cells.push({ column, row });
      }
    }
  }
  return cells;
}

/**
 * The whole ground plane as one sprite.
 *
 * Rock cells get their cap art here too even though a standing block covers it:
 * the cap and face of the near-most block together span the cell exactly, so
 * what is underneath is never seen — but if the block heights ever vary, the
 * ground already reads as stone rather than as grass showing through a gap.
 */
export function composeGround(
  columns: number,
  rows: number,
  map: readonly string[] = FIELD_MAP,
): PixelSpriteSource {
  return composeTiles(columns, rows, (column, row) => GROUND_SOURCE[terrainAt(column, row, map)]);
}

/** Screen position of a cell's near edge, centred — where an actor's feet go. */
export function cellFoot(
  column: number,
  row: number,
  groundTop: number,
): { readonly x: number; readonly y: number } {
  return {
    x: column * TILE_WIDTH + Math.floor(TILE_WIDTH / 2),
    y: groundTop + (row + 1) * TILE_DEPTH,
  };
}
