/**
 * From a lattice sample to "which tile goes where": the ground's whole layout
 * for one pose, as plain data.
 *
 * Pure and Phaser-free so the lab and the tests can compose exactly what the
 * game composes. The layer turns a plan into pixels (`ground-layer.ts`); the lab
 * turns the same plan into a text sprite (`composeGrid`).
 *
 * Coordinates are on the zero-phase grid, relative to the grid's top-left cell
 * (`minX`, `maxY`): the ground surface is one image the size of the grid. The
 * ground is flat - anything that stands is a landform or a body, not a tile.
 */

import { TILE_DEPTH, TILE_WIDTH } from "../projection";
import { packGroundKey } from "./ground-tiles";
import { cellLattice, DIRT, latticeIndex, type GroundSample } from "./ground-sample";

export interface Placement {
  readonly key: number;
  readonly x: number;
  readonly y: number;
}

export interface GroundPlan {
  readonly width: number;
  readonly height: number;
  readonly ground: Placement[];
}

function hashAt(sample: GroundSample, a: number, b: number): number {
  return sample.hashes[latticeIndex(sample, a, b)] ?? 0;
}

/**
 * Nine bits, one per cell node, row-major from the top (far) edge: bit 0 of
 * `values` at each node. Written as a plain loop because it runs a few thousand
 * times a step.
 */
function nodeBits(sample: GroundSample, x: number, y: number, values: ArrayLike<number>, match: number): number {
  const a = (x - sample.bounds.minX) * 2;
  const b = (y - sample.bounds.minY) * 2;
  let bits = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const value = values[latticeIndex(sample, a + column, b + 2 - row)] ?? 0;
      const bit = match < 0 ? value & 1 : value === match ? 1 : 0;
      bits |= bit << (row * 3 + column);
    }
  }
  return bits;
}

function middleOf(sample: GroundSample, x: number, y: number): number {
  const { a, b } = cellLattice(sample, x, y);
  return (hashAt(sample, a + 1, b + 1) >>> 1) & 7;
}

export function coloursOf(sample: GroundSample, x: number, y: number): number {
  return nodeBits(sample, x, y, sample.hashes, -1);
}

export function dirtOf(sample: GroundSample, x: number, y: number): number {
  return nodeBits(sample, x, y, sample.terrain, DIRT);
}

export function groundKey(sample: GroundSample, x: number, y: number): number {
  return packGroundKey({
    dirt: dirtOf(sample, x, y),
    colours: coloursOf(sample, x, y),
    middle: middleOf(sample, x, y),
    shade: 0,
  });
}

export function planGround(sample: GroundSample): GroundPlan {
  const { bounds } = sample;
  const ground: Placement[] = [];
  for (let localY = bounds.minY; localY <= bounds.maxY; localY += 1) {
    const top = (bounds.maxY - localY) * TILE_DEPTH;
    for (let localX = bounds.minX; localX <= bounds.maxX; localX += 1) {
      ground.push({ key: groundKey(sample, localX, localY), x: (localX - bounds.minX) * TILE_WIDTH, y: top });
    }
  }
  return {
    width: sample.columns * TILE_WIDTH,
    height: sample.rows * TILE_DEPTH,
    ground,
  };
}
