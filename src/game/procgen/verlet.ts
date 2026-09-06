/**
 * Pinned Verlet chains: rope, vine, weeping branch, chain, cloth strip.
 *
 * A chain is a line of points that remember where they were last step, plus a
 * relaxation pass that pulls neighbours back to a rest length. That is the
 * whole simulation, and it buys motion no keyframe can: a willow frond that is
 * still whipping half a second after the gust has passed, because the energy is
 * in the point's own velocity rather than in a curve someone drew.
 *
 * Two properties make it safe to ship inside this pipeline:
 *
 * - **Fixed sub-steps.** A frame's delta is chopped into `CHAIN_STEP_MS`
 *   slices, so the same elapsed time produces the same shape whether the
 *   browser delivered it at 60 or 144 fps. Verlet with a variable dt is not
 *   just imprecise, it is *unreproducible*, which would put every willow
 *   capture in the lab beyond comparison.
 * - **No allocation per step.** The points are made once and mutated, the same
 *   bargain `spark-emitter.ts` strikes for particles.
 *
 * Positions stay in floats and are snapped only when a cloud is built, so a
 * frond moving a third of a pixel a frame still moves.
 */

import type { InkId, PixelCloud } from "../ink";
import { strokeLine } from "../ink";
import { MAX_STEP_MS } from "../spark-emitter";
import { pixelHash } from "../transforms";

/** One fixed simulation slice. Small enough to be stable at these stiffnesses. */
export const CHAIN_STEP_MS = 16;

export interface ChainPoint {
  x: number;
  y: number;
  /** Where it was one sub-step ago; the difference *is* its velocity. */
  previousX: number;
  previousY: number;
}

export interface ChainConfig {
  readonly anchorX: number;
  readonly anchorY: number;
  readonly segments: number;
  readonly restLength: number;
  /** Downward acceleration, logical pixels per ms squared. */
  readonly gravity: number;
  /** Velocity retained per sub-step, 0..1. Lower is a wetter, deader rope. */
  readonly damping: number;
  /** Constraint relaxation passes. More is stiffer and costs linearly. */
  readonly iterations: number;
  readonly seed: number;
}

export interface Chain {
  readonly config: ChainConfig;
  readonly points: ChainPoint[];
  accumulatorMs: number;
}

export const DEFAULT_CHAIN: ChainConfig = {
  anchorX: 0,
  anchorY: 0,
  segments: 6,
  restLength: 2,
  gravity: 0.00022,
  damping: 0.985,
  iterations: 3,
  seed: 0x5eed,
};

/**
 * A chain hanging straight down from its anchor, with a seeded sideways lean so
 * a stand of them does not read as a comb.
 */
export function createChain(overrides: Partial<ChainConfig> = {}): Chain {
  const config: ChainConfig = { ...DEFAULT_CHAIN, ...overrides };
  if (!Number.isInteger(config.segments) || config.segments < 1) {
    throw new Error("A chain needs at least one segment");
  }
  if (config.restLength <= 0) {
    throw new Error("Chain rest length must be greater than zero");
  }

  const lean = (pixelHash(0, 0, config.seed, 3) - 0.5) * 0.6;
  const points: ChainPoint[] = [];
  for (let index = 0; index <= config.segments; index += 1) {
    const x = config.anchorX + lean * index;
    const y = config.anchorY + config.restLength * index;
    points.push({ x, y, previousX: x, previousY: y });
  }
  return { config, points, accumulatorMs: 0 };
}

export interface ChainForce {
  /** Sideways push, logical pixels per ms squared. Wind lives here. */
  readonly x: number;
  readonly y: number;
}

/**
 * Advance the chain, in fixed slices, under a force that may vary per point.
 *
 * `forceAt` receives the point's index and its normalised depth down the chain,
 * so wind can be made to bite harder at the free end — which is what stops a
 * frond swinging like a rigid pendulum.
 */
export function stepChain(
  chain: Chain,
  dtMs: number,
  forceAt: (index: number, depth: number) => ChainForce,
): void {
  chain.accumulatorMs += Math.min(Math.max(dtMs, 0), MAX_STEP_MS);
  while (chain.accumulatorMs >= CHAIN_STEP_MS) {
    chain.accumulatorMs -= CHAIN_STEP_MS;
    integrate(chain, forceAt);
    for (let pass = 0; pass < chain.config.iterations; pass += 1) {
      relax(chain);
    }
  }
}

function integrate(chain: Chain, forceAt: (index: number, depth: number) => ChainForce): void {
  const { damping, gravity, segments } = chain.config;
  const dt = CHAIN_STEP_MS;
  for (let index = 1; index < chain.points.length; index += 1) {
    const point = chain.points[index];
    if (point === undefined) {
      continue;
    }
    const force = forceAt(index, index / segments);
    const velocityX = (point.x - point.previousX) * damping;
    const velocityY = (point.y - point.previousY) * damping;
    point.previousX = point.x;
    point.previousY = point.y;
    point.x += velocityX + force.x * dt * dt;
    point.y += velocityY + (force.y + gravity) * dt * dt;
  }
}

/** One relaxation pass: pull every pair back to rest, anchor immovable. */
function relax(chain: Chain): void {
  const rest = chain.config.restLength;
  for (let index = 0; index < chain.points.length - 1; index += 1) {
    const a = chain.points[index];
    const b = chain.points[index + 1];
    if (a === undefined || b === undefined) {
      continue;
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy) || 1;
    const correction = (distance - rest) / distance;
    // The anchor takes none of the correction; every other joint splits it.
    const share = index === 0 ? 1 : 0.5;
    if (index !== 0) {
      a.x += dx * correction * share;
      a.y += dy * correction * share;
    }
    b.x -= dx * correction * share;
    b.y -= dy * correction * share;
  }
}

/** Put the chain back where `createChain` made it, velocities and all. */
export function resetChain(chain: Chain): void {
  const fresh = createChain(chain.config);
  chain.points.forEach((point, index) => {
    const source = fresh.points[index];
    if (source === undefined) {
      return;
    }
    point.x = source.x;
    point.y = source.y;
    point.previousX = source.previousX;
    point.previousY = source.previousY;
  });
  chain.accumulatorMs = 0;
}

/** Stroke the chain into a cloud, snapping to logical pixels on the way out. */
export function chainCloud(chain: Chain, ink: InkId, tipInk?: InkId): PixelCloud {
  const cloud: PixelCloud = [];
  for (let index = 0; index < chain.points.length - 1; index += 1) {
    const a = chain.points[index];
    const b = chain.points[index + 1];
    if (a === undefined || b === undefined) {
      continue;
    }
    strokeLine(cloud, { x: Math.round(a.x), y: Math.round(a.y) }, { x: Math.round(b.x), y: Math.round(b.y) }, ink);
  }
  const tip = chain.points[chain.points.length - 1];
  if (tip !== undefined && tipInk !== undefined) {
    cloud.push({ x: Math.round(tip.x), y: Math.round(tip.y), ink: tipInk });
  }
  return cloud;
}
