/**
 * The floor of a cave chamber: which tile each grid cell shows, and the tiles.
 *
 * The same contract as the overworld's ground (`ground-layer.ts`): the grid
 * belongs to the screen, and a cell shows whatever the planet point under it
 * is - here, how far that point is from the mouth. Inside the chamber it is
 * rough stone; round the mouth, the stone the day falls on; past the wall,
 * the dark of solid rock.
 *
 * Every tile is generated, never drawn: a base of noise that is periodic on
 * the tile - so any two tiles meet without a seam - and, on the plain stone,
 * a seeded detail kept a pixel clear of the edges (a pebble, a crack, a scatter
 * of grit), so neighbours differ without the join showing.
 */

import { caveDistance, CHAMBER_RADIUS, EXIT_GLOW } from "./caves";
import type { InkId, PixelCloud } from "./ink";
import type { PlanetPoint } from "./planet";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import { rampInk } from "./shading";
import { pixelHash } from "./transforms";

export type FloorKind = "stone" | "lit" | "rock";

export interface FloorKey {
  readonly kind: FloorKind;
  /** 0..`FLOOR_VARIANTS - 1`; only plain stone varies. */
  readonly variant: number;
}

export const FLOOR_VARIANTS = 4;

const SEED = 0xf100;

/** Pixels per cell of the tile's noise lattice: divides the tile both ways. */
const LATTICE = 4;

const STONE: readonly InkId[] = ["stone-1", "stone-2", "stone-3"];
const LIT: readonly InkId[] = ["stone-3", "stone-4", "stone-5"];
const ROCK: readonly InkId[] = ["void", "stone-0", "stone-1"];

/** What a planet point shows in this cave's chamber. */
export function floorCell(cave: PlanetPoint, point: PlanetPoint): FloorKey {
  const distance = caveDistance(cave, point);
  if (distance > CHAMBER_RADIUS) {
    return { kind: "rock", variant: 0 };
  }
  if (distance < EXIT_GLOW) {
    return { kind: "lit", variant: 0 };
  }
  const variant = Math.floor(pixelHash(Math.floor(point.x), Math.floor(point.y), SEED) * FLOOR_VARIANTS);
  return { kind: "stone", variant: Math.min(variant, FLOOR_VARIANTS - 1) };
}

/** Smooth noise that repeats every tile, 0..1: what lets any tile sit beside any other. */
export function tileNoise(x: number, y: number, seed: number): number {
  const columns = TILE_WIDTH / LATTICE;
  const rows = TILE_DEPTH / LATTICE;
  const u = x / LATTICE;
  const v = y / LATTICE;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const at = (i: number, j: number): number =>
    pixelHash((((x0 + i) % columns) + columns) % columns, (((y0 + j) % rows) + rows) % rows, seed);
  const near = at(0, 0) * (1 - fx) + at(1, 0) * fx;
  const far = at(0, 1) * (1 - fx) + at(1, 1) * fx;
  return near * (1 - fy) + far * fy;
}

/** One floor tile as a cloud, top-left at (0, 0), `TILE_WIDTH` x `TILE_DEPTH`. */
export function floorTileCloud(key: FloorKey): PixelCloud {
  const ramp = key.kind === "rock" ? ROCK : key.kind === "lit" ? LIT : STONE;
  const cloud: PixelCloud = [];
  for (let y = 0; y < TILE_DEPTH; y += 1) {
    for (let x = 0; x < TILE_WIDTH; x += 1) {
      const level = 0.15 + tileNoise(x, y, SEED) * 0.55 + tileNoise(x * 2, y * 2, SEED ^ 0x5) * 0.25;
      cloud.push({ x, y, ink: rampInk(ramp, level, { x, y }) });
    }
  }
  if (key.kind === "stone") {
    cloud.push(...stoneDetail(key.variant));
  }
  return cloud;
}

/** A plain stone tile's one feature, a pixel clear of every edge. */
function stoneDetail(variant: number): PixelCloud {
  const at = (salt: number, span: number): number => 1 + Math.floor(pixelHash(variant, salt, SEED) * (span - 2));
  const x = at(1, TILE_WIDTH - 2);
  const y = at(2, TILE_DEPTH - 2);
  switch (variant) {
    case 1:
      // A pebble, lit from above, with its shadow under it.
      return [
        { x, y, ink: "stone-4" },
        { x: x + 1, y, ink: "stone-3" },
        { x, y: y + 1, ink: "stone-0" },
        { x: x + 1, y: y + 1, ink: "stone-0" },
      ];
    case 2:
      // A crack, wandering a few pixels across the slab.
      return [0, 1, 2, 3, 4].map((step) => ({
        x: Math.min(x + step, TILE_WIDTH - 2),
        y: Math.min(y + (pixelHash(variant, step, SEED ^ 0x7) < 0.5 ? 0 : 1), TILE_DEPTH - 2),
        ink: "stone-0" as const,
      }));
    case 3:
      // Grit and old earth swept into a hollow.
      return [0, 1, 2, 3, 4, 5].map((step) => ({
        x: Math.min(x + Math.floor(pixelHash(step, 3, SEED) * 4), TILE_WIDTH - 2),
        y: Math.min(y + Math.floor(pixelHash(step, 4, SEED) * 3), TILE_DEPTH - 2),
        ink: step % 2 === 0 ? ("earth-1" as const) : ("earth-2" as const),
      }));
    default:
      return [];
  }
}

/** A stable string per tile, for a cache. */
export function floorKeyId(key: FloorKey): string {
  return `${key.kind}-${key.variant}`;
}
