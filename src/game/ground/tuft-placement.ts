/**
 * Where the tufts grow, for one pose, and how each one answers the wind.
 *
 * Pure: a lattice sample in, a list of tufts out. Every choice is seeded from
 * the *planet* point under the cell (its lattice hash), never from the cell's
 * place on the screen, so a tuft keeps its shape, its spot and its flowers as
 * the world scrolls under it - the same identity rule `tuftSeed` kept for the
 * old sticks.
 *
 * Tufts are rooted anywhere inside their cell and are wider than it, so the
 * field reads as one meadow rather than as a grid with a plant in each square.
 * They never root on the path (checked against the same smooth path cover the
 * ground tile draws, so a tuft cannot sprout from the visible earth) or on rock.
 */

import { valueNoise2 } from "../procgen/noise";
import { TILE_DEPTH, TILE_WIDTH } from "../projection";
import { pixelHash } from "../transforms";
import { dirtOf } from "./ground-plan";
import { cellLattice, cellTerrain, latticeIndex, ROCK, type GroundSample } from "./ground-sample";
import { pathCover } from "./ground-tiles";
import { TUFT_KINDS } from "./tufts";

export interface TuftPlacement {
  readonly localY: number;
  /** Root, in pixels from the grid's top-left on the zero-phase grid. */
  readonly x: number;
  readonly y: number;
  readonly shape: number;
  /** How much of the wind this tuft takes, and its private idle phase. */
  readonly flex: number;
  readonly phase: number;
  /** Fractional wind-grid coordinates of the root. */
  readonly windU: number;
  readonly windV: number;
  /** The planet point at the middle of the tuft's cell - what a "bare ground" test reads. */
  readonly planetX: number;
  readonly planetY: number;
}

/** Wind is sampled every `WIND_SPACING` lattice steps (two tiles) and interpolated. */
export const WIND_SPACING = 4;

const SHAPES_BY_KIND = (kinds: readonly string[]): number[] =>
  TUFT_KINDS.flatMap((kind, index) => (kinds.includes(kind) ? [index] : []));

const COMMON = SHAPES_BY_KIND(["grass", "tall", "clover", "fern"]);
const FLOWERS = SHAPES_BY_KIND(["flower"]);
const DRY = SHAPES_BY_KIND(["dry", "tall"]);

function pick(list: readonly number[], roll: number): number {
  return list[Math.floor(roll * list.length)] ?? 0;
}

/**
 * A tuft's shape, with a little geography: flowers come in drifts and dry grass
 * in patches, both from slow noise over the planet, so a meadow has places in it.
 */
function chooseShape(seed: number, planetX: number, planetY: number, salt: number): number {
  const roll = pixelHash(salt, 1, seed, 3);
  const flowery = valueNoise2(planetX / 6, planetY / 6, 0xf10e);
  const dry = valueNoise2(planetX / 9, planetY / 9, 0xd41);
  if (flowery > 0.6 && roll < 0.45) {
    return pick(FLOWERS, pixelHash(salt, 2, seed, 4));
  }
  if (dry > 0.66 && roll < 0.6) {
    return pick(DRY, pixelHash(salt, 3, seed, 5));
  }
  return pick(COMMON, pixelHash(salt, 4, seed, 6));
}

function tuftCount(seed: number): number {
  const roll = pixelHash(0, 0, seed, 7);
  return roll < 0.3 ? 1 : roll < 0.75 ? 2 : 3;
}

function cellTufts(sample: GroundSample, localX: number, localY: number, out: TuftPlacement[]): void {
  const { a, b } = cellLattice(sample, localX, localY);
  const centre = latticeIndex(sample, a + 1, b + 1);
  const seed = sample.hashes[centre] ?? 0;
  const planetX = sample.planetX[centre] ?? 0;
  const planetY = sample.planetY[centre] ?? 0;
  const dirt = dirtOf(sample, localX, localY);
  const left = (localX - sample.bounds.minX) * TILE_WIDTH;
  const top = (sample.bounds.maxY - localY) * TILE_DEPTH;
  const count = tuftCount(seed);
  for (let index = 0; index < count; index += 1) {
    const dx = 1 + Math.floor(pixelHash(index, 5, seed, 8) * (TILE_WIDTH - 2));
    const dy = 1 + Math.floor(pixelHash(index, 6, seed, 9) * (TILE_DEPTH - 2));
    if (dirt !== 0 && pathCover(dirt, dx, dy) > 0.3) {
      continue;
    }
    const x = left + dx;
    const y = top + dy;
    out.push({
      localY,
      x,
      y,
      shape: chooseShape(seed, planetX, planetY, index),
      flex: 0.75 + pixelHash(index, 7, seed, 10) * 0.5,
      phase: pixelHash(index, 8, seed, 11) * Math.PI * 2,
      windU: x / (TILE_WIDTH / 2) / WIND_SPACING,
      windV: (sample.rows * TILE_DEPTH - y) / (TILE_DEPTH / 2) / WIND_SPACING,
      planetX,
      planetY,
    });
  }
}

/** Every tuft on the visible grid, far rows first. */
export function placeTufts(sample: GroundSample): TuftPlacement[] {
  const tufts: TuftPlacement[] = [];
  const { bounds } = sample;
  for (let localY = bounds.maxY; localY >= bounds.minY; localY -= 1) {
    for (let localX = bounds.minX; localX <= bounds.maxX; localX += 1) {
      tufts.push(...tuftsInCell(sample, localX, localY));
    }
  }
  return tufts;
}

/**
 * The tufts rooted in one cell - none on rock. `placeTufts` is this over the
 * whole grid; the horizon lip asks cell by cell, for only the cells it shows.
 */
export function tuftsInCell(sample: GroundSample, localX: number, localY: number): TuftPlacement[] {
  const tufts: TuftPlacement[] = [];
  if (cellTerrain(sample, localX, localY) !== ROCK) {
    cellTufts(sample, localX, localY, tufts);
  }
  return tufts;
}

/** Bend levels per unit of `windAt`: a normal gust bends the tips two or three pixels. */
const WIND_GAIN = 4;
/** A little private sway, so a lull is not a freeze. */
const IDLE_SWAY = 0.45;

/**
 * How far a tuft leans in a gust, in bend levels (`bendFrame` takes it): its
 * share of the wind plus its private idle sway. One answer, so the field and
 * the lip past it sway the same blade the same way.
 */
export function swayBend(tuft: TuftPlacement, gust: number, elapsedMs: number): number {
  return gust * WIND_GAIN * tuft.flex + Math.sin(elapsedMs * 0.0021 + tuft.phase) * IDLE_SWAY;
}

/** A puddle as the grass sees it: a centre in grid pixels and its nominal radius. */
export interface WaterPatch {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/**
 * The widest a puddle of this nominal radius is ever drawn, across and deep:
 * the water layer scales it up to 1.1x when the ground is soaked, its ragged
 * edge reaches 1.3x, and it lies foreshortened (0.8 spread x 0.75 pitch).
 */
const WATER_REACH = 1.1 * 1.3;
const WATER_DEPTH = 0.8 * 0.75;

/**
 * Is this tuft rooted in standing water? Grass draws above the puddle layer,
 * so a tuft left in a puddle would show straight through it.
 */
export function inWater(tuft: TuftPlacement, patches: readonly WaterPatch[]): boolean {
  for (const patch of patches) {
    const across = patch.radius * WATER_REACH + 2;
    const deep = patch.radius * WATER_REACH * WATER_DEPTH + 1;
    const u = (tuft.x - patch.x) / across;
    const v = (tuft.y - patch.y) / deep;
    if (u * u + v * v < 1) {
      return true;
    }
  }
  return false;
}

/** The wind grid for a sample: planet points every `WIND_SPACING` lattice steps. */
export interface WindGrid {
  readonly width: number;
  readonly height: number;
  /** Planet coordinates of each node, in logical pixels (tiles x 16). */
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** This frame's wind per node - refilled by the layer. */
  readonly value: Float32Array;
}

export function windGrid(sample: GroundSample): WindGrid {
  const width = Math.ceil((sample.latticeWidth - 1) / WIND_SPACING) + 1;
  const height = Math.ceil((sample.latticeHeight - 1) / WIND_SPACING) + 1;
  const x = new Float32Array(width * height);
  const y = new Float32Array(width * height);
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const index = latticeIndex(sample, i * WIND_SPACING, j * WIND_SPACING);
      x[j * width + i] = (sample.planetX[index] ?? 0) * TILE_WIDTH;
      y[j * width + i] = (sample.planetY[index] ?? 0) * TILE_WIDTH;
    }
  }
  return { width, height, x, y, value: new Float32Array(width * height) };
}

/** Bilinear wind at fractional grid coordinates. */
export function windBetween(grid: WindGrid, u: number, v: number): number {
  const cu = Math.min(Math.max(u, 0), grid.width - 1.0001);
  const cv = Math.min(Math.max(v, 0), grid.height - 1.0001);
  const i = Math.floor(cu);
  const j = Math.floor(cv);
  const fu = cu - i;
  const fv = cv - j;
  const at = (di: number, dj: number): number => grid.value[(j + dj) * grid.width + i + di] ?? 0;
  return (at(0, 0) * (1 - fu) + at(1, 0) * fu) * (1 - fv) + (at(0, 1) * (1 - fu) + at(1, 1) * fu) * fv;
}
