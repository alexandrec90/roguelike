/**
 * Where water stands on open ground: a field of shallow basins over the whole
 * planet, and a water level that rises with the rain.
 *
 * The planet's ground is flat, so a "basin" is not a shape in it - it is a
 * seeded, wrapping value over planet points, 0..1, saying how readily water
 * collects there. Water stands wherever the basin is deeper than the level,
 * and the level falls as the ground soaks (`stepWetness`): bone dry, only the
 * deepest hollows hold a puddle; after a downpour they spread and join into
 * sheets several tiles across. Trodden paths collect more than grass.
 *
 * The field is baked once into a byte grid, `TEXELS_PER_TILE` to a tile, and
 * read bilinearly - by `puddleDepth` here and by a skin's shader from the very
 * same bytes uploaded as a texture. So the simulation's "is this foot in water"
 * and the picture's water edge come from one table and cannot disagree.
 *
 * Nothing stands in a landform or a lake: those are masked out.
 */

import { planetLakes } from "../lakes";
import { BLOCK_HEIGHT, fieldHeight, landformField, planetLandforms } from "../landforms";
import { PLANET_TILES, type PlanetPoint } from "../planet";
import { terrainAt } from "../terrain";

/** Grid samples per tile, each axis. */
export const TEXELS_PER_TILE = 4;

/** Samples per side of the baked grid: one planet lap. */
export const FIELD_SIZE = PLANET_TILES * TEXELS_PER_TILE;

const FIELD_SEED = 0x9d1e;

/**
 * The water level bone dry, and soaked: basins above it hold water. Set off the
 * baked field's own distribution - about 8% of open ground is under water on a
 * dry day, about 27% after a downpour (`puddle-field.test.ts` holds both).
 */
export const DRY_LEVEL = 0.76;
export const SOAKED_LEVEL = 0.62;

/** How much readier a trodden path is to hold water than grass. */
const PATH_BONUS = 0.08;

function hashUnit(x: number, y: number, seed: number): number {
  let h = Math.imul(x ^ 0x2c1b3c6d, 0x297a2d39) ^ Math.imul(y ^ seed, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/** A noise octave: `cells` lattice values a side, hashed once. */
interface Octave {
  readonly cells: number;
  readonly values: Float32Array;
}

function octave(cells: number, seed: number): Octave {
  const values = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1) {
      values[j * cells + i] = hashUnit(i, j, seed);
    }
  }
  return { cells, values };
}

/** Smooth value noise over an octave's lattice, `cells` to a planet lap: seamless at the wrap. */
function wrapNoise(x: number, y: number, { cells, values }: Octave): number {
  const u = (x / PLANET_TILES) * cells;
  const v = (y / PLANET_TILES) * cells;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = (u - x0) * (u - x0) * (3 - 2 * (u - x0));
  const fy = (v - y0) * (v - y0) * (3 - 2 * (v - y0));
  const i0 = ((x0 % cells) + cells) % cells;
  const j0 = ((y0 % cells) + cells) % cells;
  const i1 = (i0 + 1) % cells;
  const j1 = (j0 + 1) % cells;
  const a = values[j0 * cells + i0]!;
  const b = values[j0 * cells + i1]!;
  const c = values[j1 * cells + i0]!;
  const d = values[j1 * cells + i1]!;
  const near = a + (b - a) * fx;
  const far = c + (d - c) * fx;
  return near + (far - near) * fy;
}

let octaves: readonly [Octave, Octave] | undefined;

/**
 * The basin at a planet point, before masking: two octaves, the coarse one
 * placing the hollows a few tiles apart, the fine one ragging their shores.
 * `onPath` is whether the tile is trodden dirt, which holds water more readily.
 */
export function basinAt(point: PlanetPoint, onPath: boolean): number {
  octaves ??= [octave(48, FIELD_SEED), octave(160, FIELD_SEED ^ 0x55)];
  const coarse = wrapNoise(point.x, point.y, octaves[0]);
  const fine = wrapNoise(point.x, point.y, octaves[1]);
  return Math.min(Math.max(0.78 * coarse + 0.22 * fine + (onPath ? PATH_BONUS : 0), 0), 1);
}

/** Per tile: 0 open grass, 1 open path, 2 no water (a landform or a lake's bank). */
const OPEN = 0;
const PATH = 1;
const DRY = 2;

/** The level water stands at for a ground this wet, 0..1. */
export function waterLevel(wetness: number): number {
  const wet = Math.min(Math.max(wetness, 0), 1);
  return DRY_LEVEL + (SOAKED_LEVEL - DRY_LEVEL) * wet;
}

let baked: Uint8Array | undefined;

/**
 * Every tile's ground: `OPEN`, `PATH`, or `DRY` under a landform too steep to
 * stand on (`blockedByLand`) or within a tile of a lake (`nearLake(…, 1)`).
 * Each landform and lake marks the tiles under its own footprint, rather than
 * every tile asking every one of them - the same answer, a hundredth the work.
 */
function groundTiles(): Uint8Array {
  const tiles = new Uint8Array(PLANET_TILES * PLANET_TILES);
  const mark = (tx: number, ty: number): void => {
    tiles[(((ty % PLANET_TILES) + PLANET_TILES) % PLANET_TILES) * PLANET_TILES + (((tx % PLANET_TILES) + PLANET_TILES) % PLANET_TILES)] = DRY;
  };
  for (const landform of planetLandforms()) {
    const field = landformField(landform);
    const reach = Math.ceil(field.half) + 1;
    for (let ty = Math.floor(landform.y) - reach; ty <= Math.floor(landform.y) + reach; ty += 1) {
      for (let tx = Math.floor(landform.x) - reach; tx <= Math.floor(landform.x) + reach; tx += 1) {
        if (fieldHeight(field, tx + 0.5 - landform.x, ty + 0.5 - landform.y) > BLOCK_HEIGHT) {
          mark(tx, ty);
        }
      }
    }
  }
  for (const lake of planetLakes()) {
    const reach = Math.ceil(lake.reach + 1) + 1;
    for (let ty = Math.floor(lake.y) - reach; ty <= Math.floor(lake.y) + reach; ty += 1) {
      for (let tx = Math.floor(lake.x) - reach; tx <= Math.floor(lake.x) + reach; tx += 1) {
        if (Math.hypot(tx + 0.5 - lake.x, ty + 0.5 - lake.y) < lake.reach + 1) {
          mark(tx, ty);
        }
      }
    }
  }
  for (let ty = 0; ty < PLANET_TILES; ty += 1) {
    for (let tx = 0; tx < PLANET_TILES; tx += 1) {
      const index = ty * PLANET_TILES + tx;
      if (tiles[index] !== DRY && terrainAt({ x: tx + 0.5, y: ty + 0.5 }) === "dirt") {
        tiles[index] = PATH;
      }
    }
  }
  return tiles;
}

/**
 * The whole planet's basins as bytes, row-major from planet (0, 0), worked out
 * on first use and kept. What the ground is - land, lake bank, path - is
 * decided a tile at a time: a landform's foot is steep enough that a finer mask
 * buys nothing, and asking per sample would ask every landform a million times.
 */
export function puddleField(): Uint8Array {
  if (baked !== undefined) {
    return baked;
  }
  const tiles = groundTiles();
  const field = new Uint8Array(FIELD_SIZE * FIELD_SIZE);
  for (let j = 0; j < FIELD_SIZE; j += 1) {
    for (let i = 0; i < FIELD_SIZE; i += 1) {
      const tile = tiles[Math.floor(j / TEXELS_PER_TILE) * PLANET_TILES + Math.floor(i / TEXELS_PER_TILE)];
      if (tile === DRY) {
        continue;
      }
      const basin = basinAt({ x: i / TEXELS_PER_TILE, y: j / TEXELS_PER_TILE }, tile === PATH);
      field[j * FIELD_SIZE + i] = Math.round(basin * 255);
    }
  }
  baked = field;
  return field;
}

/**
 * The baked basin at a planet point, bilinear between samples and wrapping -
 * the read a GPU does with `LINEAR` filtering and `REPEAT`, where sample (i, j)
 * sits at texel centre `(i + 0.5) / FIELD_SIZE`.
 */
export function sampleField(field: Uint8Array, point: PlanetPoint): number {
  const u = point.x * TEXELS_PER_TILE - 0.5;
  const v = point.y * TEXELS_PER_TILE - 0.5;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const at = (a: number, b: number): number =>
    (field[(((b % FIELD_SIZE) + FIELD_SIZE) % FIELD_SIZE) * FIELD_SIZE + (((a % FIELD_SIZE) + FIELD_SIZE) % FIELD_SIZE)] ?? 0) / 255;
  const near = at(i, j) + (at(i + 1, j) - at(i, j)) * fu;
  const far = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fu;
  return near + (far - near) * fv;
}

/** How deep the standing water is at a point, 0 where it is dry: the basin's share over the level. */
export function puddleDepth(point: PlanetPoint, wetness: number): number {
  return Math.max(sampleField(puddleField(), point) - waterLevel(wetness), 0);
}
