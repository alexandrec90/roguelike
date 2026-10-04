/**
 * The inside of one cave: a long, winding tunnel that ends.
 *
 * A cave is a place with a far end you can walk to, not a pocket with a wall
 * round it. Its map is laid out in **cave coordinates**: `along` runs from the
 * mouth (0) straight ahead of the way the hero was facing when he walked in,
 * and `across` runs to his right. The mouth's art faces the camera from every
 * heading, so whichever way he went in, the tunnel opens in front of him.
 *
 *     along  < 0      a short alcove behind the mouth: the way out, lit by the day
 *     0 .. length     the tunnel - its centre meanders, its width breathes, the
 *                     odd pillar stands in a wide stretch
 *     length          a round chamber, and past it rock: the end of the cave
 *
 * Everything is sampled once onto a grid of `CAVE_RES` cells a tile, seeded by
 * the cave: what stands at each cell (a height, in tiles - 0 is floor) and a
 * grain the floor and the walls are inked from. Drawing (`cave-march.ts`) and
 * walking (`caveBlocked`) both read the grid, so what you see stopping you is
 * what stops you.
 */

import type { Cave } from "./caves";
import { toLocal, type PlanetPoint, type PlanetPose } from "./planet";
import { valueNoise2 } from "./procgen/noise";
import { pixelHash } from "./transforms";

/** Grid cells per tile, each way. */
export const CAVE_RES = 4;

/** How tall a cave's walls stand, in tiles. */
export const WALL_TILES = 3;

/** How tall a pillar stands. */
const PILLAR_TILES = 2.5;

/** Shortest and longest tunnel, tiles. Kept under half a lap of the planet, so it never meets itself. */
export const MIN_LENGTH = 70;
const LENGTH_SPAN = 40;

/** Radius of the chamber the tunnel ends in. */
export const END_RADIUS = 5;

/** Tiles round the way out lit by the day behind it. */
export const EXIT_GLOW = 1.25;

/** Tiles between torches along the tunnel. */
const TORCH_SPACING = 9;

/** The grid's extent past the tunnel on every side, tiles. */
const ACROSS = 24;
const BEHIND = 4;
const BEYOND = 12;

export interface CavePoint {
  readonly across: number;
  readonly along: number;
}

export interface Torch extends CavePoint {
  readonly seed: number;
}

export interface CaveMap {
  readonly seed: number;
  /** Tiles from the mouth to the end chamber's middle. */
  readonly length: number;
  /** Cave coordinates of the grid's first cell. */
  readonly minAcross: number;
  readonly minAlong: number;
  readonly columns: number;
  readonly rows: number;
  /** What stands in each cell, in eighths of a tile; 0 is open floor. Row-major by `along`. */
  readonly heights: Uint8Array;
  /** 0..255 per cell: the stone's grain. */
  readonly grain: Uint8Array;
  readonly torches: readonly Torch[];
}

/** Where a planet point is in a cave entered at `entry` (the mouth, facing the way the hero went in). */
export function caveCoords(entry: PlanetPose, point: PlanetPoint): CavePoint {
  const local = toLocal(entry, point);
  return { across: local.x, along: local.y };
}

/** The tunnel's middle at a distance in: wandering, but straight out of the mouth. */
export function tunnelCentre(seed: number, along: number): number {
  const wander = valueNoise2(along / 16, 0.5, seed) - valueNoise2(0, 0.5, seed);
  return wander * 14 * Math.min(Math.max(along / 8, 0), 1);
}

/** The tunnel's width at a distance in: a narrow throat at the mouth, then breathing. */
export function tunnelWidth(seed: number, along: number): number {
  const open = 3 + valueNoise2(along / 10, 3.5, seed ^ 0x2) * 6;
  return along < 3 ? 2.6 : along < 8 ? 2.6 + ((open - 2.6) * (along - 3)) / 5 : open;
}

function tunnelLength(seed: number): number {
  return MIN_LENGTH + Math.floor(pixelHash(seed, 0, 0xde7) * LENGTH_SPAN);
}

/** Whether a pillar stands at a point: a few in each wide stretch, never in the way of the middle. */
function pillarAt(seed: number, across: number, along: number, length: number): boolean {
  const cellX = Math.floor(across / 4);
  const cellY = Math.floor(along / 4);
  if (pixelHash(cellX, cellY, seed ^ 0x9) >= 0.3) {
    return false;
  }
  const px = cellX * 4 + 1 + pixelHash(cellX, cellY, seed ^ 0xa) * 2;
  const py = cellY * 4 + 1 + pixelHash(cellX, cellY, seed ^ 0xb) * 2;
  if (py < 10 || py > length - 4 || tunnelWidth(seed, py) < 6 || Math.abs(px - tunnelCentre(seed, py)) < 1.5) {
    return false;
  }
  return Math.hypot(across - px, along - py) < 0.6;
}

/** What stands at a point of a cave: 0 on open floor, a height in tiles on rock. */
export function shapeAt(seed: number, length: number, across: number, along: number): number {
  if (along < -1.5) {
    return WALL_TILES;
  }
  if (along < 0) {
    return Math.abs(across) < 1.4 ? 0 : WALL_TILES;
  }
  const rough = (valueNoise2(across * 1.2, along * 1.2, seed ^ 0x1) - 0.5) * 0.9;
  const inTunnel =
    along <= length && Math.abs(across - tunnelCentre(seed, along)) < tunnelWidth(seed, along) / 2 + rough;
  const inEnd = Math.hypot(across - tunnelCentre(seed, length), along - length) < END_RADIUS + rough;
  if (!inTunnel && !inEnd) {
    return WALL_TILES;
  }
  return pillarAt(seed, across, along, length) ? PILLAR_TILES : 0;
}

const MAPS = new Map<number, CaveMap>();

/** The map of one cave, sampled once and kept. */
export function caveMap(cave: Cave): CaveMap {
  let map = MAPS.get(cave.id);
  if (map === undefined) {
    map = buildMap(cave.seed);
    MAPS.set(cave.id, map);
  }
  return map;
}

/** A map for a seed, sampled onto its grid. Exported for tests and the lab. */
export function buildMap(seed: number): CaveMap {
  const length = tunnelLength(seed);
  const minAcross = -ACROSS;
  const minAlong = -BEHIND;
  const columns = ACROSS * 2 * CAVE_RES;
  const rows = (length + BEHIND + BEYOND) * CAVE_RES;
  const heights = new Uint8Array(columns * rows);
  const grain = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    const along = minAlong + (row + 0.5) / CAVE_RES;
    for (let column = 0; column < columns; column += 1) {
      const across = minAcross + (column + 0.5) / CAVE_RES;
      const index = row * columns + column;
      heights[index] = Math.round(shapeAt(seed, length, across, along) * 8);
      const smooth = valueNoise2(across * 0.9, along * 0.9, seed ^ 0x3);
      grain[index] = Math.round((smooth * 0.65 + pixelHash(column, row, seed ^ 0x4) * 0.35) * 255);
    }
  }
  const partial = { seed, length, minAcross, minAlong, columns, rows, heights, grain, torches: [] };
  return { ...partial, torches: placeTorches(partial) };
}

function cellOf(map: CaveMap, across: number, along: number): number {
  const column = Math.floor((across - map.minAcross) * CAVE_RES);
  const row = Math.floor((along - map.minAlong) * CAVE_RES);
  if (column < 0 || row < 0 || column >= map.columns || row >= map.rows) {
    return -1;
  }
  return row * map.columns + column;
}

/** Tiles of rock standing at a cave point; 0 on the floor. Off the grid is rock. */
export function heightAt(map: CaveMap, across: number, along: number): number {
  const cell = cellOf(map, across, along);
  return cell < 0 ? WALL_TILES : (map.heights[cell] ?? 0) / 8;
}

/** The stone's grain at a cave point, 0..1. */
export function grainAt(map: CaveMap, across: number, along: number): number {
  const cell = cellOf(map, across, along);
  return cell < 0 ? 0 : (map.grain[cell] ?? 0) / 255;
}

/** Whether a walker is stopped at a planet point, in a cave entered at `entry`. */
export function caveBlocked(map: CaveMap, entry: PlanetPose, point: PlanetPoint): boolean {
  const at = caveCoords(entry, point);
  return heightAt(map, at.across, at.along) > 0;
}

/**
 * Torches on the walls: every `TORCH_SPACING` tiles in, on alternate sides,
 * each set at the last open cell before the wall - and one on the end
 * chamber's back wall, so the end is lit when you reach it.
 */
function placeTorches(map: CaveMap): Torch[] {
  const torches: Torch[] = [];
  let side = 1;
  for (let along = 6; along < map.length - 2; along += TORCH_SPACING) {
    const at = wallFoot(map, tunnelCentre(map.seed, along), along, side, 0);
    if (at !== undefined) {
      torches.push({ ...at, seed: torches.length * 131 + map.seed });
    }
    side = -side;
  }
  const end = wallFoot(map, tunnelCentre(map.seed, map.length), map.length, 0, 1);
  if (end !== undefined) {
    torches.push({ ...end, seed: torches.length * 131 + map.seed });
  }
  return torches;
}

/** Walk from a point by (dx, dy) a quarter tile at a time to the last open cell before rock. */
function wallFoot(map: CaveMap, across: number, along: number, dx: number, dy: number): CavePoint | undefined {
  if (heightAt(map, across, along) > 0) {
    return undefined;
  }
  let x = across;
  let y = along;
  for (let step = 0; step < 4 * 16; step += 1) {
    const nx = x + dx / 4;
    const ny = y + dy / 4;
    if (heightAt(map, nx, ny) > 0) {
      return { across: x, along: y };
    }
    x = nx;
    y = ny;
  }
  return undefined;
}
