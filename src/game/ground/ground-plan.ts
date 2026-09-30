/**
 * From a lattice sample to "which tile goes where": the ground's whole layout
 * for one pose, as plain data.
 *
 * Pure and Phaser-free so the lab and the tests can compose exactly what the
 * game composes. The layer turns a plan into pixels (`ground-layer.ts`); the lab
 * turns the same plan into a text sprite (`composeGrid`).
 *
 * Coordinates are on the zero-phase grid, relative to the grid's top-left cell
 * (`minX`, `maxY`): the ground surface is one image the size of the grid, and
 * each rock row is one image `ROCK_ROW_HEIGHT` tall whose top is the row's
 * lifted cap.
 */

import { TILE_DEPTH, TILE_WIDTH, WALL_RISE } from "../projection";
import { packGroundKey } from "./ground-tiles";
import {
  cellLattice,
  cellTerrain,
  DIRT,
  latticeIndex,
  ROCK,
  type GroundSample,
} from "./ground-sample";
import { packCapKey, packFaceKey, ROCK_EAST, ROCK_NORTH, ROCK_SOUTH, ROCK_WEST } from "./rock-tiles";

/** A rock row image spans the lifted cap (`WALL_RISE` up) to the cell's near edge. */
export const ROCK_ROW_HEIGHT = WALL_RISE + TILE_DEPTH;
/** Where the face starts inside a rock row image: the cap's near edge. */
export const FACE_TOP = TILE_DEPTH;

export interface Placement {
  readonly key: number;
  readonly x: number;
  readonly y: number;
}

export interface RockRowPlan {
  /** Local y of the row. */
  readonly localY: number;
  readonly caps: Placement[];
  readonly faces: Placement[];
}

export interface GroundPlan {
  readonly width: number;
  readonly height: number;
  readonly ground: Placement[];
  /** Index `localY - minY`: one per grid row, empty when the row has no rock. */
  readonly rockRows: RockRowPlan[];
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

function rock(sample: GroundSample, x: number, y: number): boolean {
  return cellTerrain(sample, x, y) === ROCK;
}

export function groundKey(sample: GroundSample, x: number, y: number): number {
  const shade = rock(sample, x, y)
    ? 0
    : (rock(sample, x - 1, y + 1) ? 1 : 0) | (rock(sample, x, y + 1) ? 2 : 0) | (rock(sample, x + 1, y + 1) ? 4 : 0);
  return packGroundKey({
    dirt: dirtOf(sample, x, y),
    colours: coloursOf(sample, x, y),
    middle: middleOf(sample, x, y),
    shade,
  });
}

export function capKey(sample: GroundSample, x: number, y: number): number {
  const neighbours =
    (rock(sample, x, y + 1) ? ROCK_NORTH : 0) |
    (rock(sample, x + 1, y) ? ROCK_EAST : 0) |
    (rock(sample, x, y - 1) ? ROCK_SOUTH : 0) |
    (rock(sample, x - 1, y) ? ROCK_WEST : 0);
  return packCapKey({ rock: neighbours, colours: coloursOf(sample, x, y), middle: middleOf(sample, x, y) });
}

export function faceKey(sample: GroundSample, x: number, y: number): number {
  const { a, b } = cellLattice(sample, x, y);
  const colours = (hashAt(sample, a, b) & 1) | ((hashAt(sample, a + 1, b) & 1) << 1) | ((hashAt(sample, a + 2, b) & 1) << 2);
  return packFaceKey({
    openLeft: !rock(sample, x - 1, y),
    openRight: !rock(sample, x + 1, y),
    colours,
    middle: middleOf(sample, x, y),
  });
}

export function planGround(sample: GroundSample): GroundPlan {
  const { bounds } = sample;
  const ground: Placement[] = [];
  const rockRows: RockRowPlan[] = [];
  for (let localY = bounds.minY; localY <= bounds.maxY; localY += 1) {
    const row: RockRowPlan = { localY, caps: [], faces: [] };
    const top = (bounds.maxY - localY) * TILE_DEPTH;
    for (let localX = bounds.minX; localX <= bounds.maxX; localX += 1) {
      const left = (localX - bounds.minX) * TILE_WIDTH;
      ground.push({ key: groundKey(sample, localX, localY), x: left, y: top });
      if (!rock(sample, localX, localY)) {
        continue;
      }
      row.caps.push({ key: capKey(sample, localX, localY), x: left, y: 0 });
      if (!rock(sample, localX, localY - 1)) {
        row.faces.push({ key: faceKey(sample, localX, localY), x: left, y: FACE_TOP });
      }
    }
    rockRows.push(row);
  }
  return {
    width: sample.columns * TILE_WIDTH,
    height: sample.rows * TILE_DEPTH,
    ground,
    rockRows,
  };
}

/** A row's content as one comparable string, so an unchanged row is not re-uploaded. */
export function rowSignature(row: RockRowPlan): string {
  return `${row.caps.map((cap) => `${cap.x}:${cap.key}`).join(",")}|${row.faces.map((face) => `${face.x}:${face.key}`).join(",")}`;
}
