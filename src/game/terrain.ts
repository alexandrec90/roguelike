/**
 * What the planet is made of - as a field, deliberately, not as a grid.
 *
 * This is the module that makes a rotating camera legal. A tile *map* is a
 * lattice, and a lattice viewed through a frame that has turned 3 degrees is a
 * lattice drawn on diagonals: either the tiles rotate (which the pixel contract
 * forbids outright) or the sampling snaps and the ground crawls. So the planet
 * is given no lattice at all. Terrain is a continuous, seeded, wrapping
 * function of `(x, y)`, and the **only** grid in the game is the local one bolted
 * to the camera, where every tile blits axis-aligned at 1:1 forever.
 *
 * The consequence worth stating out loud: a "tile" is no longer a thing the
 * world has, it is a sample the screen takes. Walk half a tile and the field
 * slides half a tile under a grid that never moved; turn, and the field flows
 * through that same grid. Nothing is ever resampled, rotated or scaled.
 *
 * Two fields, both built from one wrapping value noise so the seam at
 * `PLANET_TILES` is not a seam, and the point things laid over them:
 *
 * | Field     | Reads as                                                     |
 * | --------- | ------------------------------------------------------------ |
 * | path      | two octaves; the contour at 0.5 is trodden dirt, and meanders |
 * | features  | a jittered lattice of point things - trees, puddles           |
 *
 * The ground is flat. It used to stand up in blocks wherever an elevation field
 * crossed a threshold, which put a grid on a planet that has none; anything
 * with height is now a landform (`landforms.ts`), a shape at a planet point, and
 * nothing grows inside one.
 *
 * Features are the exception that proves the rule: a tree is one sprite with an
 * identity, so it *does* get a discrete position, hashed out of a planet cell
 * and jittered inside it. It is drawn at a continuous local position rather
 * than snapped to the grid, which is exactly why it may be.
 */

import { blockedByLand } from "./landforms";
import { PLANET_TILES, wrapTile, type PlanetPoint } from "./planet";

export type Terrain = "grass" | "dirt";

/** One seed for the whole planet, so a capture of it is reproducible. */
export const PLANET_SEED = 0x5eed;

/** Half-width of the contour band the path field draws, in field units. */
const PATH_WIDTH = 0.025;

/** A point thing on the planet: where it is, and the seed that shapes it. */
export interface Feature {
  readonly x: number;
  readonly y: number;
  /** Stable per feature, so its generated shape does not change as you walk. */
  readonly seed: number;
  /** Radius in logical pixels for the things that have one; 0 for the rest. */
  readonly size: number;
}

export interface FeatureSpec {
  readonly seed: number;
  /** Share of planet cells that carry one. */
  readonly density: number;
  readonly minSize: number;
  readonly maxSize: number;
  readonly grows: (terrain: Terrain) => boolean;
}

const TREES: FeatureSpec = {
  seed: 0x71ee,
  density: 0.013,
  minSize: 0,
  maxSize: 0,
  grows: (terrain) => terrain === "grass",
};

const PUDDLES: FeatureSpec = {
  seed: 0x9a7e,
  density: 0.01,
  minSize: 6,
  maxSize: 13,
  grows: () => true,
};

function hashUnit(x: number, y: number, seed: number): number {
  let h = Math.imul(x ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul(y ^ seed, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Value noise on a lattice of `cells` cells per planet lap.
 *
 * The lattice index is taken modulo `cells`, which is what makes the field
 * seamless: walk `PLANET_TILES` in any direction and the noise is bit-identical,
 * so the wrap has no visible join to hide.
 */
function wrapNoise(x: number, y: number, cells: number, seed: number): number {
  const u = (x / PLANET_TILES) * cells;
  const v = (y / PLANET_TILES) * cells;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = smoothstep(u - x0);
  const fy = smoothstep(v - y0);
  const at = (i: number, j: number): number =>
    hashUnit((((x0 + i) % cells) + cells) % cells, (((y0 + j) % cells) + cells) % cells, seed);
  const near = at(0, 0) * (1 - fx) + at(1, 0) * fx;
  const far = at(0, 1) * (1 - fx) + at(1, 1) * fx;
  return near * (1 - fy) + far * fy;
}

/**
 * Grass, unless something has walked it to dirt.
 *
 * The path is a *contour* of a smooth field rather than a drawn line, which is
 * what gives it the one property a drawn line cannot have on a round world: it
 * closes. Follow it far enough and it comes back.
 */
export function terrainAt(point: PlanetPoint): Terrain {
  // Two octaves so the contour meanders instead of drawing smooth ovals: the
  // coarse one decides where the path goes, the fine one gives it a wobble
  // roughly a tile wide, which is what makes it read as trodden rather than
  // drawn. 21 cells to a lap puts one crossing every dozen tiles or so, which
  // is about one per screen.
  const path =
    0.82 * wrapNoise(point.x, point.y, 21, PLANET_SEED ^ 0x7d) +
    0.18 * wrapNoise(point.x, point.y, 74, PLANET_SEED ^ 0x91);
  return Math.abs(path - 0.5) < PATH_WIDTH ? "dirt" : "grass";
}

/**
 * Every feature of one kind within `reach` tiles of a planet point.
 *
 * Swept as a square of planet cells rather than as the rotated screen box:
 * `reach` is the radius that box fits inside, so the answer is independent of
 * which way the hero happens to be facing - a tree must not pop into being
 * because he turned round. Nothing grows inside a landform.
 */
export function featuresNear(centre: PlanetPoint, reach: number, spec: FeatureSpec): Feature[] {
  const found: Feature[] = [];
  const left = Math.floor(centre.x - reach);
  const top = Math.floor(centre.y - reach);
  const span = Math.ceil(reach * 2) + 1;

  for (let row = 0; row < span; row += 1) {
    for (let column = 0; column < span; column += 1) {
      const feature = featureIn(wrapTile(left + column), wrapTile(top + row), spec);
      if (feature !== undefined) {
        found.push(feature);
      }
    }
  }
  return found;
}

/** The feature one planet cell holds, if any: its hash, its jitter, and the ground it would stand on. */
function featureIn(cellX: number, cellY: number, spec: FeatureSpec): Feature | undefined {
  if (hashUnit(cellX, cellY, spec.seed) >= spec.density) {
    return undefined;
  }
  const point = {
    x: wrapTile(cellX + hashUnit(cellX, cellY, spec.seed ^ 0x11)),
    y: wrapTile(cellY + hashUnit(cellX, cellY, spec.seed ^ 0x22)),
  };
  if (!spec.grows(terrainAt(point)) || blockedByLand(point)) {
    return undefined;
  }
  const shape = hashUnit(cellX, cellY, spec.seed ^ 0x33);
  return {
    ...point,
    seed: Math.floor(shape * 0xffff),
    size: Math.round(spec.minSize + shape * (spec.maxSize - spec.minSize)),
  };
}

/** Planet cells per side of a cached chunk of features. */
const FEATURE_CHUNK = 16;

const FEATURE_CHUNKS = new Map<number, Map<number, readonly (Feature | undefined)[]>>();

/**
 * `featuresNear`, from a cache: the same cells in the same order, each chunk of
 * them hashed once and kept, since features never move. Asked every time the
 * hero crosses a tile out to the horizon, the uncached sweep - a square over a
 * hundred cells a side, each candidate checked against every landform - was
 * the largest part of the horizon lip's cost on that frame.
 */
export function cachedFeaturesNear(centre: PlanetPoint, reach: number, spec: FeatureSpec): Feature[] {
  let chunks = FEATURE_CHUNKS.get(spec.seed);
  if (chunks === undefined) {
    chunks = new Map();
    FEATURE_CHUNKS.set(spec.seed, chunks);
  }
  const found: Feature[] = [];
  const left = Math.floor(centre.x - reach);
  const top = Math.floor(centre.y - reach);
  const span = Math.ceil(reach * 2) + 1;
  for (let row = 0; row < span; row += 1) {
    for (let column = 0; column < span; column += 1) {
      const cellX = wrapTile(left + column);
      const cellY = wrapTile(top + row);
      const feature = chunkOf(chunks, cellX, cellY, spec)[(cellY % FEATURE_CHUNK) * FEATURE_CHUNK + (cellX % FEATURE_CHUNK)];
      if (feature !== undefined) {
        found.push(feature);
      }
    }
  }
  return found;
}

function chunkOf(
  chunks: Map<number, readonly (Feature | undefined)[]>,
  cellX: number,
  cellY: number,
  spec: FeatureSpec,
): readonly (Feature | undefined)[] {
  const chunkX = Math.floor(cellX / FEATURE_CHUNK);
  const chunkY = Math.floor(cellY / FEATURE_CHUNK);
  const key = chunkY * (PLANET_TILES / FEATURE_CHUNK) + chunkX;
  let chunk = chunks.get(key);
  if (chunk === undefined) {
    chunk = Array.from({ length: FEATURE_CHUNK * FEATURE_CHUNK }, (_unused, index) =>
      featureIn(chunkX * FEATURE_CHUNK + (index % FEATURE_CHUNK), chunkY * FEATURE_CHUNK + Math.floor(index / FEATURE_CHUNK), spec),
    );
    chunks.set(key, chunk);
  }
  return chunk;
}

export function treesNear(centre: PlanetPoint, reach: number): readonly Feature[] {
  return featuresNear(centre, reach, TREES);
}

export function puddlesNear(centre: PlanetPoint, reach: number): readonly Feature[] {
  return cachedFeaturesNear(centre, reach, PUDDLES);
}
