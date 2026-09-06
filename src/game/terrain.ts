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
 * Three fields, layered, all built from one wrapping value noise so the seam at
 * `PLANET_TILES` is not a seam:
 *
 * | Field     | Reads as                                                     |
 * | --------- | ------------------------------------------------------------ |
 * | elevation | fbm; above `ROCK_LEVEL` it is standing rock                   |
 * | path      | two octaves; the contour at 0.5 is trodden dirt, and meanders |
 * | features  | a jittered lattice of point things - trees, puddles           |
 *
 * Features are the exception that proves the rule: a tree is one sprite with an
 * identity, so it *does* get a discrete position, hashed out of a planet cell
 * and jittered inside it. It is drawn at a continuous local position rather
 * than snapped to the grid, which is exactly why it may be.
 */

import { PLANET_TILES, wrapTile, type PlanetPoint } from "./planet";

export type Terrain = "grass" | "dirt" | "rock";

/** One seed for the whole planet, so a capture of it is reproducible. */
export const PLANET_SEED = 0x5eed;

/** Elevation above which the ground stands up as a rock block. */
const ROCK_LEVEL = 0.622;

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

interface FeatureSpec {
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
  grows: (terrain) => terrain !== "rock",
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
 * Four octaves, and the top two are the ones that matter.
 *
 * The screen sees about 23 by 18 tiles. An octave whose features are 50 tiles
 * across is a *continent*: correct on a map of the planet, and invisible from
 * the ground, because the whole window sits inside one of them. So the mix is
 * weighted toward `SCREEN_CELLS` and above - features of two to six tiles - and
 * the continent octave is left in only to decide which regions are stony at
 * all. Getting this wrong is not subtle and is not something a unit test will
 * tell you: the first build of this had 17% rock on the planet and none of it
 * in sight from anywhere a player would ever stand.
 */
export function elevationAt(point: PlanetPoint): number {
  return (
    0.34 * wrapNoise(point.x, point.y, 5, PLANET_SEED) +
    0.3 * wrapNoise(point.x, point.y, 17, PLANET_SEED ^ 0x1f) +
    0.24 * wrapNoise(point.x, point.y, 43, PLANET_SEED ^ 0x2c) +
    0.12 * wrapNoise(point.x, point.y, 97, PLANET_SEED ^ 0x3b)
  );
}

/**
 * Grass unless the ground stands up or something has walked it flat.
 *
 * The path is a *contour* of a smooth field rather than a drawn line, which is
 * what gives it the one property a drawn line cannot have on a round world: it
 * closes. Follow it far enough and it comes back.
 */
export function terrainAt(point: PlanetPoint): Terrain {
  if (elevationAt(point) > ROCK_LEVEL) {
    return "rock";
  }
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

export function isRockAt(point: PlanetPoint): boolean {
  return terrainAt(point) === "rock";
}

/**
 * The nearest point to `near` that something can stand on.
 *
 * A generated world owes nobody a clear spawn: the point a scene wants to put
 * an actor is as likely to be inside an outcrop as not, and an actor inside
 * rock is invisible rather than obviously wrong. Spiralling out to the first
 * open point costs a handful of samples once and removes the whole class of
 * "why is the torch missing at this seed".
 */
export function openGround(near: PlanetPoint): PlanetPoint {
  for (let radius = 0; radius < 48; radius += 1) {
    const steps = Math.max(1, radius * 6);
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const point = {
        x: wrapTile(near.x + radius * Math.cos(angle)),
        y: wrapTile(near.y + radius * Math.sin(angle)),
      };
      if (terrainAt(point) !== "rock") {
        return point;
      }
    }
  }
  return near;
}

/**
 * Every feature of one kind within `reach` tiles of a planet point.
 *
 * Swept as a square of planet cells rather than as the rotated screen box:
 * `reach` is the radius that box fits inside, so the answer is independent of
 * which way the hero happens to be facing - a tree must not pop into being
 * because he turned round.
 */
function featuresNear(centre: PlanetPoint, reach: number, spec: FeatureSpec): Feature[] {
  const found: Feature[] = [];
  const left = Math.floor(centre.x - reach);
  const top = Math.floor(centre.y - reach);
  const span = Math.ceil(reach * 2) + 1;

  for (let row = 0; row < span; row += 1) {
    for (let column = 0; column < span; column += 1) {
      const cellX = wrapTile(left + column);
      const cellY = wrapTile(top + row);
      if (hashUnit(cellX, cellY, spec.seed) >= spec.density) {
        continue;
      }
      const point = {
        x: wrapTile(cellX + hashUnit(cellX, cellY, spec.seed ^ 0x11)),
        y: wrapTile(cellY + hashUnit(cellX, cellY, spec.seed ^ 0x22)),
      };
      if (!spec.grows(terrainAt(point))) {
        continue;
      }
      const shape = hashUnit(cellX, cellY, spec.seed ^ 0x33);
      found.push({
        ...point,
        seed: Math.floor(shape * 0xffff),
        size: Math.round(spec.minSize + shape * (spec.maxSize - spec.minSize)),
      });
    }
  }
  return found;
}

export function treesNear(centre: PlanetPoint, reach: number): readonly Feature[] {
  return featuresNear(centre, reach, TREES);
}

export function puddlesNear(centre: PlanetPoint, reach: number): readonly Feature[] {
  return featuresNear(centre, reach, PUDDLES);
}
