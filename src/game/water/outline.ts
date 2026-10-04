/**
 * The shape of standing water: a seeded, foreshortened outline about a centre,
 * traced once into pixels and kept.
 *
 * A puddle and a lake are the same outline at two sizes - an ellipse lying on
 * the ground with seeded lobes pushed into it, and past a tile's width a ragged
 * shore of finer ones - so this one module answers for both: which pixels are
 * water (`traceOutline`), whether one offset is (`outlineHolds`, for a caller
 * that needs the shape without its pixels), and how near and far its shore
 * comes on the ground (`outlineExtent`, the disc a lake's planet half is built
 * on). `puddles.ts` places the traced outline and draws what is on it.
 */

import { DEPTH_RATIO, TILE_DEPTH, TILE_WIDTH } from "../projection";
import { pixelHash } from "../transforms";

/** One water pixel about its puddle's centre, and whether it is on the rim. */
export interface WaterOffset {
  readonly dx: number;
  readonly dy: number;
  readonly edge: boolean;
}

/** An outline traced about its own centre: every water pixel, and a membership test. */
export interface TracedOutline {
  readonly radiusY: number;
  readonly offsets: readonly WaterOffset[];
  /** Whether an offset from the centre is water, read off the grid it was traced into. */
  readonly inside: (dx: number, dy: number) => boolean;
}

/** Widest the seeded lobes can push the outline past the base ellipse - a lake's included. */
export const EDGE_GAIN = 1.4;

/**
 * How deep a puddle is compared to how wide it is, **in the world** — before
 * the camera foreshortens it.
 *
 * Water spreads to the shallowest ground it can find, so a puddle is a broad
 * lens rather than a disc, and this is the difference between reading as water
 * lying on a field and reading as a rock seen from above. It is a separate
 * number from `DEPTH_RATIO` on purpose: that one is the camera and is not the
 * water's business to have an opinion about.
 */
export const PUDDLE_SPREAD = 0.8;

/**
 * How much finer shoreline an outline this wide carries, 0..1.
 *
 * A puddle is a lens with a lobe or two; a lake that only had those would be a
 * blown-up puddle, smooth as a pebble. Water that size has a shore - coves and
 * points - so past a tile's width the outline gains two higher harmonics,
 * fading in rather than switching on, so no puddle changes shape for it.
 */
function shoreDetail(radiusX: number): number {
  return Math.min(Math.max((radiusX - 16) / 32, 0), 1);
}

/** Samples of the outline round one turn: fine enough that no pixel can tell the table from the sines. */
const EDGE_SAMPLES = 1024;
const EDGES = new Map<string, (theta: number) => number>();
const EDGE_LIMIT = 512;

/**
 * The outline's radius at every angle, as a multiple of the base ellipse.
 *
 * Seeded harmonics, all periodic in theta, so the boundary closes on itself
 * instead of showing a seam where the angle wraps. Kept per outline, since the
 * grass asks it of every tuft near a lake each step.
 */
function edgeScale(seed: number, radiusX: number): (theta: number) => number {
  const key = `${seed}:${radiusX}`;
  let edge = EDGES.get(key);
  if (edge === undefined) {
    edge = edgeTable(seed, radiusX);
    if (EDGES.size >= EDGE_LIMIT) {
      EDGES.clear();
    }
    EDGES.set(key, edge);
  }
  return edge;
}

/**
 * The harmonics sampled once into a table and read back by linear
 * interpolation: tracing a lake asks tens of thousands of angles, and four
 * sines each was most of a 40 ms frame.
 */
function edgeTable(seed: number, radiusX: number): (theta: number) => number {
  const phaseTwo = pixelHash(1, 0, seed, 21) * Math.PI * 2;
  const phaseThree = pixelHash(2, 0, seed, 22) * Math.PI * 2;
  const detail = shoreDetail(radiusX);
  const phaseFive = pixelHash(3, 0, seed, 23) * Math.PI * 2;
  const phaseSeven = pixelHash(4, 0, seed, 24) * Math.PI * 2;
  const table = new Float64Array(EDGE_SAMPLES + 1);
  for (let index = 0; index <= EDGE_SAMPLES; index += 1) {
    const theta = (index / EDGE_SAMPLES) * Math.PI * 2;
    table[index] =
      1 +
      0.17 * Math.sin(theta * 2 + phaseTwo) +
      0.1 * Math.sin(theta * 3 + phaseThree) +
      detail * (0.07 * Math.sin(theta * 5 + phaseFive) + 0.04 * Math.sin(theta * 7 + phaseSeven));
  }
  return (theta) => {
    const turn = theta / (Math.PI * 2);
    const at = (turn - Math.floor(turn)) * EDGE_SAMPLES;
    const index = Math.floor(at);
    const low = table[index] ?? 1;
    return low + ((table[index + 1] ?? low) - low) * (at - index);
  };
}

/** The depth half-axis, logical pixels, of an outline `radiusX` across lying at `spread`. */
export function depthAxis(radiusX: number, spread: number): number {
  // Lying on the ground, so authored already foreshortened by the camera pitch
  // — never drawn round and squashed at draw time. The spread is the puddle's
  // own shape; the ratio is the camera's.
  return Math.max(1, Math.round(radiusX * spread * DEPTH_RATIO));
}

/**
 * Whether an offset from the centre lies inside the outline of water this wide,
 * this seed and this spread - the test the trace runs, for a caller (grass
 * deciding where it may root) that needs the shape without its pixels.
 */
export function outlineHolds(radius: number, seed: number, dx: number, dy: number, spread = PUDDLE_SPREAD): boolean {
  const radiusX = Math.round(radius);
  return insideOutline(radiusX, depthAxis(radiusX, spread), edgeScale(seed, radiusX), dx, dy);
}

function insideOutline(
  radiusX: number,
  radiusY: number,
  edge: (theta: number) => number,
  dx: number,
  dy: number,
): boolean {
  const u = dx / radiusX;
  const v = dy / radiusY;
  const distance = Math.hypot(u, v);
  return distance === 0 || distance <= edge(Math.atan2(v, u));
}

/**
 * The nearest and farthest the shore of this outline comes to its centre, **on
 * the ground** and in tiles, over every angle.
 *
 * The camera turns with the hero and the outline is the screen's, so the only
 * planet-side promise it can keep is a disc: the water covers at least
 * `nearest` tiles round its centre whichever way the world has turned, and
 * nothing past `farthest`. That is what lets a lake's deep core block walking
 * and still always lie inside the water drawn round it.
 */
export function outlineExtent(
  radius: number,
  seed: number,
  spread = PUDDLE_SPREAD,
): { readonly nearest: number; readonly farthest: number } {
  const radiusX = Math.round(radius);
  const radiusY = depthAxis(radiusX, spread);
  const edge = edgeScale(seed, radiusX);
  let nearest = Number.POSITIVE_INFINITY;
  let farthest = 0;
  const samples = 360;
  for (let step = 0; step < samples; step += 1) {
    const theta = (step / samples) * Math.PI * 2;
    const scale = edge(theta);
    // The point on the outline at this angle, in tiles across and tiles deep.
    const across = (radiusX * scale * Math.cos(theta)) / TILE_WIDTH;
    const deep = (radiusY * scale * Math.sin(theta)) / TILE_DEPTH;
    const reach = Math.hypot(across, deep);
    nearest = Math.min(nearest, reach);
    farthest = Math.max(farthest, reach);
  }
  return { nearest, farthest };
}

/**
 * Outlines already traced, by radius and seed. A puddle's shape does not depend
 * on where it lies, and the field re-grows every puddle in reach on every step -
 * the horizon lip several dozen of them - so tracing each outline once and
 * moving it is the difference between a step that costs a millisecond and one
 * that costs fifty.
 */
const SHAPES = new Map<string, TracedOutline>();
const SHAPE_LIMIT = 512;

/** Outlines bigger than this are lakes' - no puddle, however swollen, comes near it. */
const LAKE_SHAPE_PIXELS = 2000;

/**
 * Make room by shedding the least recently used *puddle* outline. A lake's is
 * kept whatever its age: the planet has a few dozen, each is the cost of a
 * frame to trace, and the horizon lip churns through hundreds of puddles a walk
 * - which, evicting by age alone, threw out every lake behind the hero.
 */
function evictPuddleShape(): void {
  for (const [key, shape] of SHAPES) {
    if (shape.offsets.length < LAKE_SHAPE_PIXELS) {
      SHAPES.delete(key);
      return;
    }
  }
}

/** The outline of water this wide, seed and spread, traced once and kept. */
export function traceOutline(radiusX: number, seed: number, spread: number): TracedOutline {
  const key = `${radiusX}:${seed}:${spread}`;
  const known = SHAPES.get(key);
  if (known !== undefined) {
    // Most recently used last, so a full cache sheds what has not been seen for longest.
    SHAPES.delete(key);
    SHAPES.set(key, known);
    return known;
  }
  const radiusY = depthAxis(radiusX, spread);
  const edge = edgeScale(seed, radiusX);
  const spanX = Math.ceil(radiusX * EDGE_GAIN);
  const spanY = Math.ceil(radiusY * EDGE_GAIN);
  // Each pixel is tested once into a grid with a dry border, and the rim read
  // off its neighbours there: a lake is tens of thousands of tests, and asking
  // each pixel's four neighbours afresh made it five times that - a 40 ms frame
  // the first time a lake came into sight.
  const width = spanX * 2 + 3;
  const grid = new Uint8Array(width * (spanY * 2 + 3));
  const at = (dx: number, dy: number): number => (dy + spanY + 1) * width + dx + spanX + 1;
  for (let dy = -spanY; dy <= spanY; dy += 1) {
    for (let dx = -spanX; dx <= spanX; dx += 1) {
      grid[at(dx, dy)] = insideOutline(radiusX, radiusY, edge, dx, dy) ? 1 : 0;
    }
  }

  const offsets: WaterOffset[] = [];
  for (let dy = -spanY; dy <= spanY; dy += 1) {
    for (let dx = -spanX; dx <= spanX; dx += 1) {
      const here = at(dx, dy);
      if (grid[here] === 1) {
        const onRim = grid[here - 1] === 0 || grid[here + 1] === 0 || grid[here - width] === 0 || grid[here + width] === 0;
        offsets.push({ dx, dy, edge: onRim });
      }
    }
  }
  if (SHAPES.size >= SHAPE_LIMIT) {
    evictPuddleShape();
  }
  // The trace's own grid answers membership: off it is dry.
  const inside = (dx: number, dy: number): boolean =>
    Math.abs(dx) <= spanX && Math.abs(dy) <= spanY && grid[at(dx, dy)] === 1;
  const shape = { radiusY, offsets, inside };
  SHAPES.set(key, shape);
  return shape;
}
