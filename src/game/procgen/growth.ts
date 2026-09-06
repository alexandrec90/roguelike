/**
 * Space colonization: a branch skeleton grown toward light, not drawn.
 *
 * Scatter attractor points through the volume a crown is allowed to occupy,
 * then repeatedly step every branch tip toward the attractors that can see it,
 * removing an attractor once a branch has reached it. Branches compete for the
 * same points, so they fork where the volume is wide, thin out where it is
 * narrow, and never grow into each other — the structure comes out of the
 * envelope rather than out of a recursion depth.
 *
 * This is the reason two seeds give two *different trees* rather than the same
 * tree jittered. A fractal produces a shape that is obviously a rule; this
 * produces one that reads as having grown somewhere in particular.
 *
 * Thickness is the da Vinci rule — a limb is as thick as its children summed in
 * quadrature — which is what makes a trunk taper convincingly without a taper
 * curve being authored anywhere.
 *
 * The result depends only on the config, so it is computed once per seed and
 * cached; wind is applied afterwards, to the skeleton, per frame.
 */

import { pixelHash } from "../transforms";

export interface Limb {
  readonly x: number;
  readonly y: number;
  /** Index into the limb list, or -1 for the root. */
  readonly parent: number;
  /** Steps from the root — the branch order, useful for inking. */
  readonly depth: number;
  /** Radius in logical pixels, from the da Vinci rule. Tips are the thinnest. */
  readonly thickness: number;
}

export interface GrowthConfig {
  readonly seed: number;
  /** Where the trunk leaves the ground. Cloud coordinates: y negative is up. */
  readonly rootX: number;
  readonly rootY: number;
  /** The ellipse the attractors fill — the crown's envelope. */
  readonly crownX: number;
  readonly crownY: number;
  readonly crownRadiusX: number;
  readonly crownRadiusY: number;
  readonly attractors: number;
  /** How far a tip steps per generation. */
  readonly stepLength: number;
  /** An attractor pulls on tips within this range. */
  readonly attractionRadius: number;
  /** An attractor is consumed once a limb is this close. */
  readonly killRadius: number;
  readonly maxLimbs: number;
  /** Upward bias added to every step, so the tree grows rather than sprawls. */
  readonly tropism: number;
}

export const DEFAULT_GROWTH: GrowthConfig = {
  seed: 0x7ee,
  rootX: 0,
  rootY: 0,
  crownX: 0,
  crownY: -26,
  crownRadiusX: 13,
  crownRadiusY: 10,
  attractors: 140,
  stepLength: 2,
  attractionRadius: 13,
  killRadius: 2.4,
  maxLimbs: 220,
  tropism: 0.28,
};

interface Attractor {
  x: number;
  y: number;
  alive: boolean;
}

/** Seeded rejection sampling inside the crown ellipse. */
function scatter(config: GrowthConfig): Attractor[] {
  const points: Attractor[] = [];
  for (let index = 0; index < config.attractors * 4 && points.length < config.attractors; index += 1) {
    const u = pixelHash(index, 0, config.seed, 11) * 2 - 1;
    const v = pixelHash(index, 0, config.seed, 12) * 2 - 1;
    if (u * u + v * v > 1) {
      continue;
    }
    points.push({
      x: config.crownX + u * config.crownRadiusX,
      y: config.crownY + v * config.crownRadiusY,
      alive: true,
    });
  }
  return points;
}

interface Growing {
  readonly x: number;
  readonly y: number;
  readonly parent: number;
  readonly depth: number;
}

/** The straight stem from the ground to the first attractor in range. */
function trunk(config: GrowthConfig, attractors: readonly Attractor[]): Growing[] {
  const limbs: Growing[] = [{ x: config.rootX, y: config.rootY, parent: -1, depth: 0 }];
  for (let step = 0; step < config.maxLimbs; step += 1) {
    const tip = limbs[limbs.length - 1];
    if (tip === undefined || inRange(tip, attractors, config.attractionRadius)) {
      break;
    }
    limbs.push({ x: tip.x, y: tip.y - config.stepLength, parent: limbs.length - 1, depth: 0 });
  }
  return limbs;
}

function inRange(tip: Growing, attractors: readonly Attractor[], radius: number): boolean {
  return attractors.some(
    (point) => point.alive && Math.hypot(point.x - tip.x, point.y - tip.y) <= radius,
  );
}

/** One generation: every tip that owns attractors sprouts exactly one child. */
function generation(config: GrowthConfig, limbs: Growing[], attractors: Attractor[]): number {
  const pull = new Map<number, { x: number; y: number }>();
  for (const point of attractors) {
    if (!point.alive) {
      continue;
    }
    const nearest = nearestLimb(limbs, point, config.attractionRadius);
    if (nearest < 0) {
      continue;
    }
    const limb = limbs[nearest];
    if (limb === undefined) {
      continue;
    }
    const dx = point.x - limb.x;
    const dy = point.y - limb.y;
    const length = Math.hypot(dx, dy) || 1;
    const sum = pull.get(nearest) ?? { x: 0, y: 0 };
    pull.set(nearest, { x: sum.x + dx / length, y: sum.y + dy / length });
  }

  let grown = 0;
  for (const [index, direction] of pull) {
    const limb = limbs[index];
    if (limb === undefined || limbs.length >= config.maxLimbs) {
      break;
    }
    const dy = direction.y - config.tropism;
    const length = Math.hypot(direction.x, dy) || 1;
    limbs.push({
      x: limb.x + (direction.x / length) * config.stepLength,
      y: limb.y + (dy / length) * config.stepLength,
      parent: index,
      depth: limb.depth + 1,
    });
    grown += 1;
  }

  prune(limbs, attractors, config.killRadius);
  return grown;
}

function nearestLimb(limbs: readonly Growing[], point: Attractor, radius: number): number {
  let best = -1;
  let bestDistance = radius;
  limbs.forEach((limb, index) => {
    const distance = Math.hypot(point.x - limb.x, point.y - limb.y);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

function prune(limbs: readonly Growing[], attractors: Attractor[], killRadius: number): void {
  for (const point of attractors) {
    if (!point.alive) {
      continue;
    }
    if (limbs.some((limb) => Math.hypot(point.x - limb.x, point.y - limb.y) <= killRadius)) {
      point.alive = false;
    }
  }
}

/** The da Vinci rule, applied leaf-to-root: parent² = sum of children². */
function thicken(limbs: readonly Growing[]): number[] {
  const thickness = limbs.map(() => 0.55);
  for (let index = limbs.length - 1; index >= 0; index -= 1) {
    const limb = limbs[index];
    if (limb === undefined || limb.parent < 0) {
      continue;
    }
    const own = thickness[index] ?? 0.55;
    const parent = thickness[limb.parent] ?? 0.55;
    thickness[limb.parent] = Math.hypot(parent, own);
  }
  return thickness;
}

const CACHE = new Map<string, readonly Limb[]>();

/**
 * Grow a skeleton, or return the one already grown for this exact config.
 *
 * Cached because this is tens of thousands of distance tests and the answer
 * never changes: the shape of a tree is decided by its seed, and only its
 * *pose* is decided by the wind.
 */
export function growSkeleton(overrides: Partial<GrowthConfig> = {}): readonly Limb[] {
  const config: GrowthConfig = { ...DEFAULT_GROWTH, ...overrides };
  const key = JSON.stringify(config);
  const cached = CACHE.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const attractors = scatter(config);
  const limbs = trunk(config, attractors);
  prune(limbs, attractors, config.killRadius);
  for (let round = 0; round < config.maxLimbs; round += 1) {
    if (limbs.length >= config.maxLimbs || generation(config, limbs, attractors) === 0) {
      break;
    }
  }

  const thickness = thicken(limbs);
  const grown: readonly Limb[] = limbs.map((limb, index) => ({
    ...limb,
    thickness: Math.min(thickness[index] ?? 0.55, 3.2),
  }));
  CACHE.set(key, grown);
  return grown;
}

/** The limbs nothing grew from — where leaves, blossom or fruit belong. */
export function limbTips(limbs: readonly Limb[]): readonly Limb[] {
  const parents = new Set(limbs.map((limb) => limb.parent));
  return limbs.filter((_, index) => !parents.has(index));
}
