/**
 * What stands on the planet, and which species each thing is.
 *
 * The planet has always had trees — point features hashed out of planet cells
 * (`terrain.ts`) — but every one of them was the same chestnut, and the props
 * the tree lab could draw (a mossy boulder, a bush, a ring of mushrooms) never
 * reached the game at all. This is the catalogue that sends them there: a set of
 * feature lattices, each with its own seed and density, and a seeded pick of a
 * species for every feature found.
 *
 * Deterministic in the planet point alone, so a tree is the same oak every time
 * you walk back to it, and a capture of any place reproduces.
 */

import { PLANET_TILES, wrapDelta, type PlanetPoint } from "./planet";
import { featuresNear, type Feature, type FeatureSpec } from "./terrain";
import { pixelHash } from "./transforms";

/** A feature that knows what it is. */
export interface SceneryFeature extends Feature {
  readonly species: string;
}

interface Lattice {
  readonly spec: FeatureSpec;
  /** Species ids and their relative weights. */
  readonly mix: readonly (readonly [string, number])[];
}

/**
 * The woods: mostly broadleaf, a stand of spruce here and there, the odd oak
 * and ash for silhouette variety. Weights, not probabilities — they are
 * normalised per pick.
 */
const TREES: Lattice = {
  spec: {
    seed: 0x71ee,
    density: 0.013,
    minSize: 0,
    maxSize: 0,
    grows: (terrain) => terrain === "grass",
  },
  mix: [
    ["sdf-crown", 5],
    ["oak-recursive", 3],
    ["noise-canopy", 2],
    ["snow-conifer", 2],
    ["colonized-ash", 1],
  ],
};

const BUSHES: Lattice = {
  spec: {
    seed: 0xb054,
    density: 0.018,
    minSize: 0,
    maxSize: 0,
    grows: (terrain) => terrain === "grass",
  },
  mix: [["bush", 1]],
};

const STONES: Lattice = {
  spec: {
    seed: 0x5701,
    density: 0.008,
    minSize: 0,
    maxSize: 0,
    grows: (terrain) => terrain !== "rock",
  },
  mix: [["boulder", 1]],
};

const FUNGI: Lattice = {
  spec: {
    seed: 0xf09a,
    density: 0.004,
    minSize: 0,
    maxSize: 0,
    grows: (terrain) => terrain === "grass",
  },
  mix: [["mushroom-ring", 1]],
};

export const SCENERY_LATTICES: readonly Lattice[] = [TREES, BUSHES, STONES, FUNGI];

/** Every species the game can place — the bake cache warms from this list. */
export const PLACED_SPECIES: readonly string[] = SCENERY_LATTICES.flatMap((lattice) =>
  lattice.mix.map(([species]) => species),
);

/** A weighted, seeded pick. */
export function pickSpecies(mix: Lattice["mix"], seed: number): string {
  const total = mix.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = pixelHash(seed, 7, 0x5ce7) * total;
  for (const [species, weight] of mix) {
    roll -= weight;
    if (roll < 0) {
      return species;
    }
  }
  return mix[mix.length - 1]?.[0] ?? "sdf-crown";
}

/** Planet cells per side of a cached chunk; the planet is 16 chunks across. */
export const CHUNK_CELLS = 16;
const CHUNKS = PLANET_TILES / CHUNK_CELLS;
const chunks = new Map<number, readonly SceneryFeature[]>();

/**
 * Everything standing in one 16×16 chunk of planet cells, hashed once.
 *
 * Two features from different lattices can land in the same cell; the later
 * lattice loses, so a boulder never grows through a tree trunk. A cell always
 * falls in one chunk, so the rule holds across chunk edges too.
 */
function chunkFeatures(cx: number, cy: number): readonly SceneryFeature[] {
  const key = cy * CHUNKS + cx;
  const cached = chunks.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const centre = { x: cx * CHUNK_CELLS + CHUNK_CELLS / 2, y: cy * CHUNK_CELLS + CHUNK_CELLS / 2 };
  const found: SceneryFeature[] = [];
  const taken = new Set<string>();
  for (const lattice of SCENERY_LATTICES) {
    for (const feature of featuresNear(centre, CHUNK_CELLS / 2 - 0.5, lattice.spec)) {
      const cell = `${Math.floor(feature.x)},${Math.floor(feature.y)}`;
      if (taken.has(cell)) {
        continue;
      }
      taken.add(cell);
      found.push({ ...feature, species: pickSpecies(lattice.mix, feature.seed) });
    }
  }
  chunks.set(key, found);
  return found;
}

/**
 * Everything standing within `reach` tiles (a square, so it does not depend on
 * which way the hero faces) of a planet point.
 *
 * Features never move, so they are hashed once per chunk and a sweep is a few
 * array reads — it runs every step, out to the horizon, and a full re-hash of
 * that square was a visible hitch on the frame each step landed.
 */
export function sceneryNear(centre: PlanetPoint, reach: number): SceneryFeature[] {
  const found: SceneryFeature[] = [];
  const low = (value: number): number => Math.floor((value - reach) / CHUNK_CELLS);
  const high = (value: number): number => Math.floor((value + reach) / CHUNK_CELLS);
  const seen = new Set<number>();
  for (let cy = low(centre.y); cy <= high(centre.y); cy += 1) {
    for (let cx = low(centre.x); cx <= high(centre.x); cx += 1) {
      const wx = ((cx % CHUNKS) + CHUNKS) % CHUNKS;
      const wy = ((cy % CHUNKS) + CHUNKS) % CHUNKS;
      if (seen.has(wy * CHUNKS + wx)) {
        continue;
      }
      seen.add(wy * CHUNKS + wx);
      for (const feature of chunkFeatures(wx, wy)) {
        if (
          Math.abs(wrapDelta(feature.x, centre.x)) <= reach + 1 &&
          Math.abs(wrapDelta(feature.y, centre.y)) <= reach + 1
        ) {
          found.push(feature);
        }
      }
    }
  }
  return found;
}
