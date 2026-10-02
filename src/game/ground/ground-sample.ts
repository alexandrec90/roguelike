/**
 * What the visible ground is made of, read from the planet on a half-tile lattice.
 *
 * The old ground asked `terrainAt` once per cell, which is enough to choose a
 * tile and no more: a path came out as a chain of 16x12 squares because a
 * square was all the information there was. This samples the planet at every
 * cell corner, edge midpoint and centre instead - a lattice at half-tile
 * spacing - so the art can follow the *real* contour of the path field between
 * cell samples, and a winding path is drawn winding.
 *
 *      b (up the screen)
 *      ^   o---o---o     one cell spans three lattice points each way;
 *      |   |       |     neighbours share their edge points, which is what
 *      |   o   o   o     lets both sides of a join draw the same boundary
 *      |   |       |
 *      |   o---X---o     X = the cell's own sample, (x, y): the one rock
 *      +---------------> a           collision and every other system reads
 *
 * The lattice also carries a hash of the planet point under each node. The tile
 * fields in `wang.ts` take their colours from it, so a node's texture is a
 * property of the *planet*, and a patch of clover stays put as you walk over it.
 *
 * Sampling is ~1,800 `terrainAt` calls a step, which is two milliseconds cold.
 * Walking forward re-reads almost exactly the points the last step read, so
 * answers are cached by planet point: a straight walk costs one fresh row.
 */

import type { LocalBounds } from "../camera";
import { fromLocal, wrapDelta, type PlanetPose } from "../planet";
import { terrainAt, type Terrain } from "../terrain";

export const GRASS = 0;
export const DIRT = 1;

export type TerrainCode = typeof GRASS | typeof DIRT;

const CODE: Readonly<Record<Terrain, TerrainCode>> = { grass: GRASS, dirt: DIRT };

export interface GroundSample {
  readonly pose: PlanetPose;
  readonly bounds: LocalBounds;
  readonly columns: number;
  readonly rows: number;
  readonly latticeWidth: number;
  readonly latticeHeight: number;
  /** Terrain code per lattice point, `b * latticeWidth + a`. */
  readonly terrain: Uint8Array;
  /** Planet-point hash per lattice point: the Wang colours and every seed. */
  readonly hashes: Uint32Array;
  /** Planet coordinates per lattice point, in tiles - for the wind. */
  readonly planetX: Float32Array;
  readonly planetY: Float32Array;
}

/** Answers keyed by quantised planet point. Pure function, so caching is safe. */
const TERRAIN_CACHE = new Map<number, TerrainCode>();
const CACHE_LIMIT = 60_000;
/**
 * 1/64 of a tile: far below anything the lattice can resolve, and coarse enough
 * that a key stays a small integer (under 2^30), which a `Map` hashes fastest.
 */
const QUANTUM = 64;

function planetKey(x: number, y: number): number {
  return Math.round(x * QUANTUM) * 0x8000 + Math.round(y * QUANTUM);
}

export function cachedTerrain(x: number, y: number): TerrainCode {
  const key = planetKey(x, y);
  const hit = TERRAIN_CACHE.get(key);
  if (hit !== undefined) {
    return hit;
  }
  if (TERRAIN_CACHE.size >= CACHE_LIMIT) {
    TERRAIN_CACHE.clear();
  }
  const code = CODE[terrainAt({ x, y })];
  TERRAIN_CACHE.set(key, code);
  return code;
}

/**
 * A stable hash of a planet point, quantised to a quarter tile.
 *
 * Coarse on purpose: a strafe re-reads every point a hair off where it was, and
 * a hash that noticed would reshuffle the ground's texture on every sideways
 * step. A quarter tile is fine enough that neighbouring lattice points (half a
 * tile apart) never collide.
 */
export function planetHash(x: number, y: number): number {
  let h = Math.imul(Math.round(x * 4) + 0x3c6e, 0x27d4eb2d) ^ Math.imul(Math.round(y * 4) + 0x1b87, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** How close, in lattice steps, a point must land to an old node to be that node. */
const SNAP = 0.2;

interface Frame {
  readonly cos: number;
  readonly sin: number;
}

/**
 * Where a planet point sat on the previous sample's lattice, if it sat on one.
 *
 * Returns the lattice index when the point lands within `SNAP` of a node - which
 * after any step is true of every node except the row or column that just came
 * into view - and -1 otherwise.
 */
function previousNode(previous: GroundSample, frame: Frame, x: number, y: number): number {
  const dx = wrapDelta(x, previous.pose.x);
  const dy = wrapDelta(y, previous.pose.y);
  const localX = dx * frame.cos - dy * frame.sin;
  const localY = dx * frame.sin + dy * frame.cos;
  const a = (localX - previous.bounds.minX + 0.5) * 2;
  const b = (localY - previous.bounds.minY) * 2;
  const ra = Math.round(a);
  const rb = Math.round(b);
  if (Math.abs(a - ra) > SNAP || Math.abs(b - rb) > SNAP) {
    return -1;
  }
  if (ra < 0 || rb < 0 || ra >= previous.latticeWidth || rb >= previous.latticeHeight) {
    return -1;
  }
  return rb * previous.latticeWidth + ra;
}

/**
 * Read the lattice for a pose.
 *
 * With `previous`, a node that lands on one of the previous sample's nodes
 * **inherits that node's hash** instead of hashing its own planet point. That
 * is what keeps the ground still under a strafe: sideways steps swing the world
 * round a pivot, so every point comes back a few hundredths of a tile off where
 * it was, and a hash of the raw position would re-roll most of the texture on
 * every step. Terrain is never inherited - it is always read fresh, so what is
 * drawn as rock is exactly what the hero collides with.
 */
export function sampleGround(pose: PlanetPose, bounds: LocalBounds, previous?: GroundSample): GroundSample {
  const sample = emptySample(pose, bounds);
  const read = nodeReader(sample, previous);
  for (let b = 0; b < sample.latticeHeight; b += 1) {
    for (let a = 0; a < sample.latticeWidth; a += 1) {
      read(a, b);
    }
  }
  return sample;
}

/** A sample whose nodes are read only where they are asked for. */
export interface LazyGroundSample {
  readonly sample: GroundSample;
  /**
   * Read every node a cell's keys and tufts can look at - its own and its
   * eight neighbours' - if they have not been read yet. Call it before asking
   * anything of the cell.
   */
  readonly readAround: (localX: number, localY: number) => void;
}

/**
 * `sampleGround`, node by node on demand, for a region far bigger than what is
 * read of it - the horizon lip, whose rectangle out to the horizon is seventeen
 * times the field and whose frames read a tenth of it. Every node it reads is
 * exactly the node `sampleGround` would have read.
 */
export function lazyGroundSample(pose: PlanetPose, bounds: LocalBounds, previous?: GroundSample): LazyGroundSample {
  const sample = emptySample(pose, bounds);
  const read = nodeReader(sample, previous);
  const done = new Uint8Array(sample.terrain.length);
  const readAround = (localX: number, localY: number): void => {
    const { a, b } = cellLattice(sample, localX, localY);
    for (let nb = Math.max(b - 2, 0); nb <= Math.min(b + 4, sample.latticeHeight - 1); nb += 1) {
      for (let na = Math.max(a - 2, 0); na <= Math.min(a + 4, sample.latticeWidth - 1); na += 1) {
        const index = nb * sample.latticeWidth + na;
        if (done[index] === 0) {
          done[index] = 1;
          read(na, nb);
        }
      }
    }
  };
  return { sample, readAround };
}

function emptySample(pose: PlanetPose, bounds: LocalBounds): GroundSample {
  const columns = bounds.maxX - bounds.minX + 1;
  const rows = bounds.maxY - bounds.minY + 1;
  const latticeWidth = columns * 2 + 1;
  const latticeHeight = rows * 2 + 1;
  const size = latticeWidth * latticeHeight;
  return {
    pose,
    bounds,
    columns,
    rows,
    latticeWidth,
    latticeHeight,
    terrain: new Uint8Array(size),
    hashes: new Uint32Array(size),
    planetX: new Float32Array(size),
    planetY: new Float32Array(size),
  };
}

/** Reads one lattice node of `sample` off the planet, inheriting `previous`'s hash where it can. */
function nodeReader(sample: GroundSample, previous?: GroundSample): (a: number, b: number) => void {
  const { pose, bounds } = sample;
  const frame = previous === undefined ? undefined : { cos: Math.cos(previous.pose.turn), sin: Math.sin(previous.pose.turn) };
  return (a, b) => {
    const point = fromLocal(pose, { x: bounds.minX - 0.5 + a / 2, y: bounds.minY + b / 2 });
    const index = b * sample.latticeWidth + a;
    sample.terrain[index] = cachedTerrain(point.x, point.y);
    const inherited = previous === undefined || frame === undefined ? -1 : previousNode(previous, frame, point.x, point.y);
    sample.hashes[index] = inherited >= 0 ? (previous?.hashes[inherited] ?? 0) : planetHash(point.x, point.y);
    sample.planetX[index] = point.x;
    sample.planetY[index] = point.y;
  };
}

let lastSample: GroundSample | undefined;

/**
 * `sampleGround`, remembered for the pose it was taken at.
 *
 * The ground and the grass both need the lattice for the same pose on the same
 * frame; whichever asks second gets the first one's answer for free.
 */
export function sharedGroundSample(pose: PlanetPose, bounds: LocalBounds): GroundSample {
  if (lastSample?.pose === pose && sameBounds(lastSample.bounds, bounds)) {
    return lastSample;
  }
  lastSample = sampleGround(pose, bounds, lastSample);
  return lastSample;
}

function sameBounds(a: LocalBounds, b: LocalBounds): boolean {
  return a.minX === b.minX && a.maxX === b.maxX && a.minY === b.minY && a.maxY === b.maxY;
}

/** Lattice column/row of a cell's corner nodes: the cell spans `a..a+2`, `b..b+2`. */
export function cellLattice(sample: GroundSample, x: number, y: number): { a: number; b: number } {
  return { a: (x - sample.bounds.minX) * 2, b: (y - sample.bounds.minY) * 2 };
}

/** Lattice value at (a, b), clamped to the lattice so border cells see their own edge. */
export function latticeIndex(sample: GroundSample, a: number, b: number): number {
  const ca = Math.min(Math.max(a, 0), sample.latticeWidth - 1);
  const cb = Math.min(Math.max(b, 0), sample.latticeHeight - 1);
  return cb * sample.latticeWidth + ca;
}

/** The cell's own terrain: its sample point at local (x, y), exactly what `terrainAt` says. */
export function cellTerrain(sample: GroundSample, x: number, y: number): TerrainCode {
  const { a, b } = cellLattice(sample, x, y);
  return (sample.terrain[latticeIndex(sample, a + 1, b)] ?? GRASS) as TerrainCode;
}
