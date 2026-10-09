/**
 * Volcanoes and the smoke they give off, as simulation a skin reads.
 *
 * Which mountains are volcanoes, and the crater cut into each summit, is
 * `landforms.ts` (`isVolcano`) - shape is the world's, so every skin draws the
 * same crater. This file is the plume over it: a column of puffs that leaves
 * the vent, rises fast and slows as it cools, swells as it climbs, bends over
 * downwind and wanders on a curl-noise flow, and thins away at the top.
 *
 * A plume has no state. Puff `k` is born at `k × EMIT_MS` and lives `LIFE_MS`,
 * so where every puff is at any moment is a pure function of the elapsed time
 * and the vent's seed (`plumePuffs`) - the same smoke on every load, at any
 * frame rate, and nothing to step or pool. `k` runs negative too: a volcano
 * was smoking before the clock started, so the plume is whole on the first
 * frame. What a puff *looks* like - a lit ball, a raymarched volume - is the
 * skin's.
 */

import { CRATER_RIM, isVolcano, planetLandforms } from "./landforms";
import { curlFlow } from "./procgen/noise";
import { WALL_RISE } from "./projection";

/** A crater's vent: where its smoke leaves the mountain. */
export interface Vent {
  readonly id: string;
  /** Planet point of the vent. */
  readonly x: number;
  readonly y: number;
  /** Tiles above the ground: just under the crater's rim. */
  readonly z: number;
  readonly seed: number;
}

/** One puff of a plume, measured from its vent. */
export interface SmokePuff {
  /** Planet tiles from the vent, east and north. */
  readonly dx: number;
  readonly dy: number;
  /** Tiles above the ground. */
  readonly z: number;
  /** Tiles. */
  readonly radius: number;
  /** 0 as it leaves the vent, 1 as it is gone. */
  readonly age: number;
  /** 0..1, the puff's own seed: each billows on its own phase. */
  readonly seed: number;
}

/** A new puff leaves the vent this often, ms. */
export const EMIT_MS = 420;

/** How long a puff lives, ms: so a plume is `LIFE_MS / EMIT_MS` puffs. */
export const LIFE_MS = 16_000;

/** Puffs in a plume at any moment. */
export const PLUME_PUFFS = Math.ceil(LIFE_MS / EMIT_MS);

/**
 * How high a puff climbs over its life, tiles above the vent. Low on purpose:
 * a mountain already stands taller than the frame from most of the field, so
 * a plume that climbed as far again would only ever show past the horizon. It
 * bends over into a banner downwind instead.
 */
export const RISE_TILES = 11;

/** A puff's radius leaving the vent, and at the top of its climb, tiles. */
export const BIRTH_RADIUS = 0.9;
export const TOP_RADIUS = 4.2;

/** Tiles a puff is carried downwind over its life, per unit of wind. */
export const DRIFT_TILES = 22;

/** The way the smoke drifts, a planet bearing: fixed, so a plume does not swing as the hero turns. */
const DOWNWIND = { x: 0.82, y: -0.57 } as const;

/** How far the curl flow pushes a puff sideways at the top of its climb, tiles. */
const WANDER_TILES = 3.2;

let vents: readonly Vent[] | undefined;

/** Every vent on the planet, worked out once. */
export function volcanoVents(): readonly Vent[] {
  if (vents === undefined) {
    vents = planetLandforms()
      .filter(isVolcano)
      .map((landform) => ({
        id: landform.id,
        x: landform.x,
        y: landform.y,
        z: (landform.height * (CRATER_RIM - 0.08)) / WALL_RISE,
        seed: landform.seed,
      }));
  }
  return vents;
}

/** A seeded unit float from a vent and a puff number. */
function puffHash(seed: number, k: number, salt: number): number {
  let h = Math.imul(seed ^ 0x2c1b3c6d, 0x297a2d39) ^ Math.imul(k + salt * 0x9e37, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 13;
  return (h >>> 0) / 0x100000000;
}

/**
 * Every puff of a vent's plume at `elapsedMs`, oldest first, into `out`.
 * `wind` is the weather's strength (1 a breezy day); a still day still lets
 * the smoke lean a little, as warm air does.
 */
export function plumePuffs(vent: Vent, elapsedMs: number, wind: number, out: SmokePuff[] = []): SmokePuff[] {
  out.length = 0;
  const newest = Math.floor(elapsedMs / EMIT_MS);
  const drift = DRIFT_TILES * (0.25 + Math.max(wind, 0));
  for (let k = newest - PLUME_PUFFS + 1; k <= newest; k += 1) {
    const age = (elapsedMs - k * EMIT_MS) / LIFE_MS;
    if (age < 0 || age >= 1) {
      continue;
    }
    const own = puffHash(vent.seed, k, 1);
    // Hot gas leaves fast and slows as it cools: most of the climb is early.
    const climb = (1 - Math.exp(-3.2 * age)) / (1 - Math.exp(-3.2));
    // The column stands at first and bends over downwind as it loses its heat.
    const carried = drift * age ** 1.6;
    const flow = curlFlow(k * 0.21, age * 2.4, 0, vent.seed);
    const wander = WANDER_TILES * age;
    out.push({
      dx: DOWNWIND.x * carried + flow.x * wander,
      dy: DOWNWIND.y * carried + flow.y * wander,
      z: vent.z + RISE_TILES * climb * (0.85 + 0.3 * puffHash(vent.seed, k, 2)),
      radius: (BIRTH_RADIUS + (TOP_RADIUS - BIRTH_RADIUS) * Math.sqrt(age)) * (0.8 + 0.4 * own),
      age,
      seed: own,
    });
  }
  return out;
}
