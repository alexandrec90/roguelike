/**
 * A pooled particle field whose spawn point and force are supplied per step.
 *
 * `spark-emitter.ts` is the right tool when the source is a fixed point — a
 * torch, a wound, rain out of the sky. It is the wrong tool when the source
 * *moves and multiplies*: embers coming off whichever limbs are alight this
 * instant, leaves letting go of whichever twigs the gust is loading. So this is
 * the same bargain — fixed pool, seeded rolls, clamped delta — with two things
 * handed in per step instead of fixed at construction:
 *
 * - **where a mote is born**, as a callback the caller answers from its own
 *   state (which limb is burning, which twig is bare);
 * - **what pushes it**, as a force callback, which is where a `curlFlow` goes.
 *
 * A "mote" rather than a "spark" because the same pool carries embers, leaves,
 * seeds, pollen and ash; what it looks like is the ramp's business.
 */

import type { InkId, PixelCloud } from "../ink";
import { rampInk } from "../shading";
import { MAX_STEP_MS } from "../spark-emitter";

export interface MoteConfig {
  readonly capacity: number;
  readonly seed: number;
  readonly lifeMs: number;
  readonly lifeJitterMs: number;
  readonly spawnIntervalMs: number;
  /** Downward acceleration in logical pixels per ms squared. Negative rises. */
  readonly gravity: number;
  /** Velocity kept per millisecond, 0..1 — air resistance. */
  readonly drag: number;
}

export interface Mote {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageMs: number;
  lifeMs: number;
}

export interface MoteField {
  readonly config: MoteConfig;
  readonly motes: Mote[];
  untilNextSpawnMs: number;
  rngState: number;
}

export interface MoteSpawn {
  readonly x: number;
  readonly y: number;
  readonly vx?: number;
  readonly vy?: number;
}

export const DEFAULT_MOTES: MoteConfig = {
  capacity: 40,
  seed: 0x4d07e,
  lifeMs: 900,
  lifeJitterMs: 500,
  spawnIntervalMs: 55,
  gravity: -0.00004,
  drag: 0.9985,
};

export function createMotes(overrides: Partial<MoteConfig> = {}): MoteField {
  const config: MoteConfig = { ...DEFAULT_MOTES, ...overrides };
  if (!Number.isInteger(config.capacity) || config.capacity < 1) {
    throw new Error("Mote capacity must be a positive integer");
  }
  if (config.spawnIntervalMs <= 0) {
    throw new Error("Mote spawn interval must be greater than zero");
  }
  const motes: Mote[] = Array.from({ length: config.capacity }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    ageMs: 0,
    lifeMs: config.lifeMs,
  }));
  return { config, motes, untilNextSpawnMs: 0, rngState: config.seed >>> 0 };
}

/** The seeded die. Advancing the state in place keeps the sequence reproducible. */
function roll(field: MoteField): number {
  field.rngState = (Math.imul(field.rngState, 1664525) + 1013904223) >>> 0;
  return field.rngState / 0x100000000;
}

export interface MoteStep {
  /** Where the next mote is born, or null to skip this spawn. */
  readonly spawn: (roll: () => number) => MoteSpawn | null;
  /** Acceleration on a mote, in logical pixels per ms squared. */
  readonly force?: (mote: Mote, life: number) => { readonly x: number; readonly y: number };
}

export function stepMotes(field: MoteField, dtMs: number, step: MoteStep): void {
  const delta = Math.min(Math.max(dtMs, 0), MAX_STEP_MS);
  advance(field, delta, step);

  field.untilNextSpawnMs -= delta;
  while (field.untilNextSpawnMs <= 0) {
    field.untilNextSpawnMs += field.config.spawnIntervalMs;
    const where = step.spawn(() => roll(field));
    if (where !== null) {
      ignite(field, where);
    }
  }
}

function advance(field: MoteField, delta: number, step: MoteStep): void {
  const { drag, gravity } = field.config;
  const decay = drag ** delta;
  for (const mote of field.motes) {
    if (!mote.active) {
      continue;
    }
    mote.ageMs += delta;
    if (mote.ageMs >= mote.lifeMs) {
      mote.active = false;
      continue;
    }
    const push = step.force?.(mote, mote.ageMs / mote.lifeMs) ?? { x: 0, y: 0 };
    mote.vx = (mote.vx + push.x * delta) * decay;
    mote.vy = (mote.vy + (push.y + gravity) * delta) * decay;
    mote.x += mote.vx * delta;
    mote.y += mote.vy * delta;
  }
}

function ignite(field: MoteField, where: MoteSpawn): void {
  const slot = field.motes.find((mote) => !mote.active);
  if (slot === undefined) {
    return;
  }
  slot.active = true;
  slot.x = where.x;
  slot.y = where.y;
  slot.vx = where.vx ?? 0;
  slot.vy = where.vy ?? 0;
  slot.ageMs = 0;
  slot.lifeMs = field.config.lifeMs + roll(field) * field.config.lifeJitterMs;
}

/**
 * Snap the live motes to logical pixels, inked by how much life is left.
 *
 * Fading through the ramp rather than through alpha is the pixel contract: a
 * half-dead ember is one ramp step cooler, not 50% transparent, so it stays a
 * colour the palette actually contains.
 */
export function moteCloud(field: MoteField, ramp: readonly InkId[], reverse = false): PixelCloud {
  const cloud: PixelCloud = [];
  for (const mote of field.motes) {
    if (!mote.active) {
      continue;
    }
    const remaining = 1 - mote.ageMs / mote.lifeMs;
    const level = reverse ? 1 - remaining : remaining;
    const x = Math.round(mote.x);
    const y = Math.round(mote.y);
    cloud.push({ x, y, ink: rampInk(ramp, level, { x, y }) });
  }
  return cloud;
}

export function resetMotes(field: MoteField): void {
  for (const mote of field.motes) {
    mote.active = false;
    mote.ageMs = 0;
  }
  field.untilNextSpawnMs = 0;
  field.rngState = field.config.seed >>> 0;
}
