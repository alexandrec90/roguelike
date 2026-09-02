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

/**
 * Where the field holds water.
 *
 * Standing water is not terrain: a puddle straddles cells, has no square edge,
 * and its shape comes from a seed rather than from a tile (`puddles.ts`). So
 * it is placed here as a list of sites rather than given a map glyph — the map
 * says what the ground *is*, this says what has collected on it.
 *
 * A site is anchored to a cell's foot so it moves with the horizon knob like
 * everything else, then nudged off it in logical pixels.
 */
export interface PuddleSite {
  readonly id: string;
  readonly column: number;
  readonly row: number;
  /** Half-width in logical pixels; the depth half-axis is foreshortened from it. */
  readonly radius: number;
  readonly seed: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
}

export const PUDDLE_SITES: readonly PuddleSite[] = [
  // The two that carry a reflection are pushed *forward* of the foot they
  // belong to: a reflection hangs below the thing it reflects, so a puddle
  // centred on the feet would clip half of it away behind them.
  { id: "hero", column: 10, row: 11, radius: 13, seed: 0x9a7e, offsetY: 5 },
  { id: "torch", column: 13, row: 10, radius: 7, seed: 0x51bd, offsetY: 4 },
  { id: "path-far", column: 7, row: 6, radius: 7, seed: 0x2c41, offsetX: 3 },
  { id: "rock-foot", column: 15, row: 5, radius: 6, seed: 0x1e93, offsetY: -2 },
  { id: "east-verge", column: 17, row: 8, radius: 8, seed: 0x77e2, offsetX: -4 },
  { id: "west-verge", column: 3, row: 12, radius: 10, seed: 0xb103, offsetX: 2 },
  { id: "path-near", column: 12, row: 12, radius: 9, seed: 0x3f0a, offsetX: 5 },
];

/** Foreground trees are models; this is only where their roots meet the map. */
export interface TreeSite {
  readonly column: number;
  readonly row: number;
  readonly seed: number;
  readonly offsetX?: number;
}

export const TREE_SITES: readonly TreeSite[] = [
  { column: 2, row: 3, seed: 0x4a11, offsetX: -2 },
  { column: 18, row: 5, seed: 0x0c72, offsetX: 3 },
  { column: 1, row: 10, seed: 0x7d03, offsetX: -1 },
  { column: 18, row: 12, seed: 0x2eb4, offsetX: 2 },
];

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
