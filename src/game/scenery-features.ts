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
  /**
   * About how tall its bodies stand, in pixels at full size: how far past the
   * horizon one still shows over the curve, so a bush that has sunk from sight
   * is not kept in a slot while a tree beyond it still shows its crown.
   */
  readonly height: number;
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
  height: 96,
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
  height: 26,
};

const STONES: Lattice = {
  spec: {
    seed: 0x5701,
    density: 0.008,
    minSize: 0,
    maxSize: 0,
    grows: () => true,
  },
  mix: [["boulder", 1]],
  height: 24,
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
  height: 14,
};

export const SCENERY_LATTICES: readonly Lattice[] = [TREES, BUSHES, STONES, FUNGI];

const HEIGHTS = new Map<string, number>(
  SCENERY_LATTICES.flatMap((lattice) => lattice.mix.map(([species]) => [species, lattice.height] as const)),
);

/** About how tall a species stands, in pixels at full size; unknown species are taken as tall. */
export function speciesHeight(species: string): number {
  return HEIGHTS.get(species) ?? 96;
}

/** Every species the game can place — the bake cache warms from this list. */
export const PLACED_SPECIES: readonly string[] = SCENERY_LATTICES.flatMap((lattice) =>
  lattice.mix.map(([species]) => species),
);

/**
 * How many distinct shapes each species comes in.
 *
 * Every body on the planet is drawn from one of these, so the whole world's
 * scenery is `PLACED_SPECIES × SCENERY_VARIANTS` bakes rather than one per tree.
 * A unique seed per tree put ~900 different bodies within sight of the horizon
 * against a cache that held 320, so bakes never caught up: trees arrived one per
 * frame and the horizon kept filling in while the hero stood still. Bounded,
 * every shape is baked before the first frame is shown (`scenery-baker.ts`).
 * Raise it for variety; each step costs about half a second of worker time at
 * load.
 */
export const SCENERY_VARIANTS = 6;

/** The seed each variant is built from, shared by every species. */
const VARIANT_SEEDS: readonly number[] = Array.from({ length: SCENERY_VARIANTS }, (_unused, variant) =>
  Math.floor(pixelHash(variant, 3, 0x5eed) * 0xffff),
);

/** The variant seed a feature's own seed draws: same feature, same shape, always. */
export function variantSeed(seed: number): number {
  const variant = Math.min(SCENERY_VARIANTS - 1, Math.floor(pixelHash(seed, 5, 0x7a21) * SCENERY_VARIANTS));
  return VARIANT_SEEDS[variant] ?? 0;
}

/** Every body the planet can show, as species and seed: what a warm-up bakes. */
export function sceneryArchetypes(): { readonly species: string; readonly seed: number }[] {
  return PLACED_SPECIES.flatMap((species) => VARIANT_SEEDS.map((seed) => ({ species, seed })));
}

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
      found.push({
        ...feature,
        species: pickSpecies(lattice.mix, feature.seed),
        seed: variantSeed(feature.seed),
      });
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
