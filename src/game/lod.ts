/**
 * Level of detail, in a world where distance mostly does not change an
 * object's size.
 *
 * The usual LOD trick — draw fewer triangles because the thing is smaller on
 * screen — barely applies here. The flat field is affine, so a tree twelve rows
 * away is drawn at *exactly* the same pixel size as one two rows away
 * (`CLAUDE.md`, Flatness); only past the field's far edge, on the horizon roll,
 * does a body shrink (`horizon.ts`, `rollScale`), and there it is the same
 * field sampled at a wider spacing rather than a cheaper model. Nothing in the
 * field gets smaller with distance, and a cheaper model would therefore be
 * plainly visible.
 *
 * Two things do change with distance, and both are worth spending:
 *
 * - **How much of the frame the object owns.** On the roll a body is genuinely
 *   a handful of pixels and its rim highlight cannot be seen at all.
 * - **How closely the player is looking.** A body the player is walking past
 *   is being watched; one across the field is peripheral, and the eye cannot
 *   follow the individual leaves it is fluttering.
 *
 * So the budget here never swaps the model. Every tier evaluates the **same
 * field**, and differs only in how finely it is sampled — warp octaves, normal
 * epsilon, whether the normal is computed at all, and how coarsely the animated
 * pose is quantised. A body that rolls closer gains detail continuously and is
 * never replaced, which is the property the whole scheme exists to protect: the
 * player walks toward the horizon and things must not pop.
 *
 * The pose quantum is the largest saving and the one that costs nothing at all
 * to look at. The render is snapped to whole pixels regardless, so snapping the
 * *inputs* to a quantum and caching the result is exact up to that quantum: a
 * far body re-rasterises a few times a second instead of sixty, and every frame
 * in between is a cache hit that draws the identical pixels it would have
 * computed.
 */

export type DetailTier = "near" | "mid" | "far" | "culled";

export interface Detail {
  readonly tier: DetailTier;
  /** Octaves in the domain warp. The first detail a distant body gives up. */
  readonly warpOctaves: number;
  /** Central-difference step for the surface normal. */
  readonly normalEpsilon: number;
  /** Skip the normal: four fewer field evaluations per pixel, no rim light. */
  readonly flat: boolean;
  readonly dither: boolean;
  /**
   * Animated pose values are snapped to this many logical pixels before the
   * body is rendered, so repeated poses hit the cache. 0 disables snapping.
   */
  readonly poseQuantum: number;
  /** Fraction of an emitter's particles a body at this distance keeps, 0..1. */
  readonly particleShare: number;
}

export const DETAIL_TIERS: Readonly<Record<DetailTier, Detail>> = {
  near: {
    tier: "near",
    warpOctaves: 2,
    normalEpsilon: 0.6,
    flat: false,
    dither: true,
    poseQuantum: 0.25,
    particleShare: 1,
  },
  mid: {
    tier: "mid",
    warpOctaves: 2,
    normalEpsilon: 0.9,
    flat: false,
    dither: true,
    poseQuantum: 1,
    particleShare: 0.5,
  },
  // Far is where the true surface normal goes, replaced by a directional
  // gradient across the body's box. That is the one shortcut whose loss is
  // genuinely invisible at distance.
  //
  // The warp keeps both octaves on purpose. Dropping the second one was tried
  // and reverted: it smooths the field, which removes the interior texture and
  // makes a far body a flat mass with a lit cap — a change of character, not a
  // loss of detail, and exactly the pop this whole scheme exists to prevent.
  // Note also that the saving was one the evaluation meter could not even see,
  // because octaves are noise calls inside the field rather than calls to it;
  // giving up something visible for something unmeasurable is a bad trade twice
  // over. `culled` still drops it, since nothing is drawn there anyway.
  far: {
    tier: "far",
    warpOctaves: 2,
    normalEpsilon: 1.4,
    flat: true,
    dither: true,
    poseQuantum: 2,
    particleShare: 0,
  },
  culled: {
    tier: "culled",
    warpOctaves: 1,
    normalEpsilon: 2,
    flat: true,
    dither: false,
    poseQuantum: 4,
    particleShare: 0,
  },
};

export interface DetailThresholds {
  /** Rows within which a body is drawn at full detail. */
  readonly nearRows?: number;
  /** Rows beyond `nearRows` that still light from a normal. */
  readonly midRows?: number;
  /** Beyond this, the body is not drawn at all. */
  readonly cullRows?: number;
}

const DEFAULT_THRESHOLDS: Required<DetailThresholds> = {
  nearRows: 4,
  midRows: 9,
  cullRows: 64,
};

/**
 * The budget for a body `rowsAway` field rows from the camera.
 *
 * A negative distance is treated as zero rather than rejected: a body straddling
 * the near edge is the most visible one on screen, and the arithmetic that
 * produced the negative is the caller's business, not a reason to stop drawing.
 */
export function detailFor(rowsAway: number, thresholds: DetailThresholds = {}): Detail {
  const { nearRows, midRows, cullRows } = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const rows = Math.max(0, rowsAway);
  if (rows > cullRows) {
    return DETAIL_TIERS.culled;
  }
  if (rows <= nearRows) {
    return DETAIL_TIERS.near;
  }
  return rows <= midRows ? DETAIL_TIERS.mid : DETAIL_TIERS.far;
}

/**
 * The budget for a body inside the horizon roll, where a dozen world rows are
 * compressed into a few scanlines.
 *
 * Separate from `detailFor` because the roll is not a distance — it is a region
 * of the screen where detail is destroyed by the projection itself, no matter
 * what row the body claims to be on.
 */
export function detailInRoll(): Detail {
  return DETAIL_TIERS.far;
}

/** Snap a value to a quantum, so equal poses produce equal cache keys. */
export function quantize(value: number, quantum: number): number {
  if (quantum <= 0) {
    return value;
  }
  return Math.round(value / quantum) * quantum;
}

export interface PoseCache<T> {
  /** Bounded: a body cycling through poses must not grow a map forever. */
  readonly capacity: number;
  readonly entries: Map<string, T>;
  hits: number;
  misses: number;
}

export function createPoseCache<T>(capacity = 24): PoseCache<T> {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error("A pose cache needs a positive integer capacity");
  }
  return { capacity, entries: new Map(), hits: 0, misses: 0 };
}

/**
 * Return the cached render for this pose, or build and remember it.
 *
 * The eviction is first-in-first-out over insertion order, which is the right
 * policy for the access pattern here: a swaying body walks its pose back and
 * forth through a small set of quantised values, so anything still in the map
 * is likely to be asked for again shortly, and the oldest entry is the pose the
 * wind has moved furthest away from.
 */
export function cachedPose<T>(cache: PoseCache<T>, key: string, build: () => T): T {
  const hit = cache.entries.get(key);
  if (hit !== undefined) {
    cache.hits += 1;
    return hit;
  }
  cache.misses += 1;
  const built = build();
  cache.entries.set(key, built);
  while (cache.entries.size > cache.capacity) {
    const oldest = cache.entries.keys().next();
    if (oldest.done === true) {
      break;
    }
    cache.entries.delete(oldest.value);
  }
  return built;
}

export function resetPoseCache(cache: PoseCache<unknown>): void {
  cache.entries.clear();
  cache.hits = 0;
  cache.misses = 0;
}

/** Cache hit rate so far, 0..1; 0 when nothing has been asked for yet. */
export function poseCacheHitRate(cache: PoseCache<unknown>): number {
  const total = cache.hits + cache.misses;
  return total === 0 ? 0 : cache.hits / total;
}
