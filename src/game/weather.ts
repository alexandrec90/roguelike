/**
 * Weather: rain and lightning, both seeded, both particle- or line-shaped.
 *
 * Rain is the same pooled emitter the torch sparks use (`spark-emitter.ts`)
 * with the velocity turned downward — one emitter implementation, two skies.
 * Lightning is a seeded jagged polyline plus a deterministic schedule, so two
 * captures of the same second of the scene show the same bolt.
 */

import { createEmitter, type EmitterConfig, type EmitterState } from "./spark-emitter";

/**
 * Rain across a `width`-wide sky. Drops spawn in a strip above the top edge
 * and fall; each lives long enough to cross most of the frame, and the pool
 * caps how hard it can ever rain.
 */
export function createRain(width: number, overrides: Partial<EmitterConfig> = {}): EmitterState {
  return createEmitter({
    capacity: 44,
    seed: 0x1d872b41,
    spawnIntervalMs: 36,
    spawnJitterMs: 40,
    lifeMs: 900,
    lifeJitterMs: 600,
    originX: Math.floor(width / 2),
    originY: -8,
    spreadX: Math.ceil(width / 2) + 8,
    spreadY: 8,
    driftX: 0.006,
    riseY: -0.16,
    ...overrides,
  });
}

export interface BoltPoint {
  readonly x: number;
  readonly y: number;
}

function hashUnit(value: number, seed: number): number {
  let h = Math.imul(value ^ seed, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 0xffffffff;
}

/**
 * A jagged strike from (x, topY) down to bottomY: short segments with seeded
 * sideways jitter and a pull back toward the strike column, so the bolt
 * wanders but arrives. Same seed, same bolt.
 */
export function lightningBolt(
  seed: number,
  x: number,
  topY: number,
  bottomY: number,
): readonly BoltPoint[] {
  if (bottomY <= topY) {
    throw new Error("A bolt must strike downward");
  }

  const points: BoltPoint[] = [{ x, y: topY }];
  let currentX = x;
  let currentY = topY;
  let step = 0;
  while (currentY < bottomY) {
    step += 1;
    currentY = Math.min(currentY + 2 + Math.floor(hashUnit(step, seed) * 3), bottomY);
    const jitter = Math.round((hashUnit(step, seed ^ 0x5bd1e995) * 2 - 1) * 3);
    const pull = Math.round((x - currentX) * 0.2);
    currentX += jitter + pull;
    points.push({ x: currentX, y: currentY });
  }
  return points;
}

export interface LightningState {
  /** Whether a bolt is on screen this instant. */
  readonly active: boolean;
  /** Flash brightness 0..1, flickering per 16ms slice while active. */
  readonly alpha: number;
  /** Seed for `lightningBolt`, stable for the whole strike. */
  readonly boltSeed: number;
  /** Unit position of the strike column, stable for the whole strike. */
  readonly xUnit: number;
}

const WINDOW_MS = 9000;
const STRIKE_MS = 160;

/**
 * The deterministic storm schedule: time is cut into windows, each window
 * either holds one strike at a seeded offset or stays quiet. Pure function of
 * (elapsed, seed) so the scene needs no storm state at all.
 */
export function lightningAt(elapsedMs: number, seed: number): LightningState {
  const window = Math.floor(elapsedMs / WINDOW_MS);
  const quiet = hashUnit(window, seed ^ 0x2545f491) < 0.3;
  const offset = hashUnit(window, seed) * (WINDOW_MS - STRIKE_MS);
  const strikeStart = window * WINDOW_MS + offset;
  const sinceStrike = elapsedMs - strikeStart;

  if (quiet || sinceStrike < 0 || sinceStrike >= STRIKE_MS) {
    return { active: false, alpha: 0, boltSeed: 0, xUnit: 0 };
  }

  const slice = Math.floor(sinceStrike / 16);
  const flicker = 0.45 + 0.55 * hashUnit(slice, seed ^ window);
  const fade = 1 - sinceStrike / STRIKE_MS;
  return {
    active: true,
    alpha: flicker * fade,
    boltSeed: Math.imul(window + 1, 0x9e3779b9) ^ seed,
    xUnit: hashUnit(window, seed ^ 0x85ebca6b),
  };
}
