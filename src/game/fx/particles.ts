/**
 * The general particle pool: every effect that is "many small things flying".
 *
 * `spark-emitter.ts` is one emitter with one behaviour (embers rising off a
 * torch). This is the primitive underneath the rest of them — flame licks,
 * smoke, sparks off a sword, slime goo, rock debris, rain splash, ice shards —
 * and what distinguishes one from another is a `ParticleSpec`: a ramp, a speed
 * and angle range, gravity, drag, a lifetime and how it fades. No effect owns a
 * colour; it owns a ramp and a level range along it.
 *
 * The rules from `procedural-effects.md` hold here by construction:
 *
 * - **Pooled and capped.** A pool is allocated once; an emit into a full pool
 *   recycles the oldest slot rather than growing.
 * - **Seeded.** Every random draw is `pixelHash(counter, salt, seed)`, so the
 *   same pool stepped by the same deltas makes the same pixels, and the lab can
 *   capture an explosion byte for byte.
 * - **Clamped steps.** A backgrounded tab does not advance an effect four
 *   seconds in one frame.
 * - **Dithered fade.** A dying particle is removed pixel by pixel against the
 *   Bayer matrix, never drawn at 50% alpha.
 *
 * Coordinates are whatever the caller's are — usually offsets from an anchor
 * that is itself world-anchored, so an explosion scrolls with the ground it
 * went off on.
 */

import type { InkId, PixelCloud } from "../ink";
import { signedNoise } from "../procgen/noise";
import { ditherThreshold, rampInk } from "../shading";
import { pixelHash } from "../transforms";

/** The largest step a pool will integrate at once. */
export const MAX_PARTICLE_STEP_MS = 50;

export interface ParticleSpec {
  /** Darkest-first ramp the particle is inked from. */
  readonly ramp: readonly InkId[];
  /** Ramp level at birth and at death, 0..1. A flame cools: 1 → 0.2. */
  readonly levelFrom: number;
  readonly levelTo: number;
  readonly lifeMs: readonly [number, number];
  /** Initial speed range, logical pixels per millisecond. */
  readonly speed: readonly [number, number];
  /** Launch angle range in radians; 0 is right, -π/2 is straight up the screen. */
  readonly angle: readonly [number, number];
  /** Constant acceleration, px/ms². Positive y falls; negative y rises (buoyancy). */
  readonly gravity?: number;
  readonly windX?: number;
  /** Fraction of velocity lost per millisecond. 0.004 is air; 0.02 is syrup. */
  readonly drag?: number;
  /** 1 is a single pixel; 2 is a 2x2 block that shrinks to 1 as it ages. */
  readonly size?: 1 | 2;
  /** Spawn scatter around the emit point, ± pixels. */
  readonly spreadX?: number;
  readonly spreadY?: number;
  /** Dither the particle away over the last share of its life, 0..1. */
  readonly fade?: number;
  /** Sideways noise wander, px/ms — a flame lick or smoke curl. */
  readonly wobble?: number;
  /**
   * A floor, in the caller's coordinates: a particle that falls to it stops
   * dead (or bounces, with `bounce`). Debris and goo land; flames never do.
   */
  readonly floor?: number;
  readonly bounce?: number;
}

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageMs: number;
  lifeMs: number;
  /** Per-particle seed, so its wobble and dither are its own. */
  seed: number;
  spec: ParticleSpec;
}

export interface ParticlePool {
  readonly particles: Particle[];
  readonly seed: number;
  /** Next slot to try; the pool is a ring, so a full pool recycles the oldest. */
  cursor: number;
  /** Draws so far — the hash counter that makes every emit distinct. */
  draws: number;
}

const IDLE_SPEC: ParticleSpec = {
  ramp: ["void"],
  levelFrom: 0,
  levelTo: 0,
  lifeMs: [1, 1],
  speed: [0, 0],
  angle: [0, 0],
};

export function createPool(capacity: number, seed: number): ParticlePool {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error("A particle pool needs a positive integer capacity");
  }
  return {
    particles: Array.from({ length: capacity }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      ageMs: 0,
      lifeMs: 1,
      seed: 0,
      spec: IDLE_SPEC,
    })),
    seed,
    cursor: 0,
    draws: 0,
  };
}

function draw(pool: ParticlePool, salt: number): number {
  return pixelHash(pool.draws, salt, pool.seed);
}

function between(range: readonly [number, number], unit: number): number {
  return range[0] + (range[1] - range[0]) * unit;
}

/** A free slot, or the oldest live one when the pool is full. */
function claim(pool: ParticlePool): Particle {
  const count = pool.particles.length;
  for (let tried = 0; tried < count; tried += 1) {
    const index = (pool.cursor + tried) % count;
    const particle = pool.particles[index] as Particle;
    if (!particle.active) {
      pool.cursor = (index + 1) % count;
      return particle;
    }
  }
  let oldest = pool.particles[0] as Particle;
  for (const particle of pool.particles) {
    if (particle.ageMs / particle.lifeMs > oldest.ageMs / oldest.lifeMs) {
      oldest = particle;
    }
  }
  return oldest;
}

export interface EmitOptions {
  /** Velocity added to every particle — a moving source's own motion. */
  readonly inheritX?: number;
  readonly inheritY?: number;
  /** Rotate the spec's angle range by this much. Aims a cone. */
  readonly turn?: number;
}

/** Launch `count` particles of one kind from a point. */
export function emit(
  pool: ParticlePool,
  spec: ParticleSpec,
  count: number,
  x: number,
  y: number,
  options: EmitOptions = {},
): void {
  for (let index = 0; index < count; index += 1) {
    pool.draws += 1;
    const particle = claim(pool);
    const angle = between(spec.angle, draw(pool, 1)) + (options.turn ?? 0);
    const speed = between(spec.speed, draw(pool, 2));
    particle.active = true;
    particle.spec = spec;
    particle.x = x + (draw(pool, 3) * 2 - 1) * (spec.spreadX ?? 0);
    particle.y = y + (draw(pool, 4) * 2 - 1) * (spec.spreadY ?? 0);
    particle.vx = Math.cos(angle) * speed + (options.inheritX ?? 0);
    particle.vy = Math.sin(angle) * speed + (options.inheritY ?? 0);
    particle.ageMs = 0;
    particle.lifeMs = Math.max(1, between(spec.lifeMs, draw(pool, 5)));
    particle.seed = Math.floor(draw(pool, 6) * 0xffff);
  }
}

/** Advance every live particle. Deltas are clamped, and long ones sub-stepped. */
export function stepParticles(pool: ParticlePool, deltaMs: number): void {
  let remaining = Math.min(Math.max(deltaMs, 0), MAX_PARTICLE_STEP_MS * 3);
  while (remaining > 0) {
    const dt = Math.min(remaining, MAX_PARTICLE_STEP_MS);
    remaining -= dt;
    for (const particle of pool.particles) {
      if (particle.active) {
        advance(particle, dt);
      }
    }
  }
}

function advance(particle: Particle, dt: number): void {
  const spec = particle.spec;
  particle.ageMs += dt;
  if (particle.ageMs >= particle.lifeMs) {
    particle.active = false;
    return;
  }
  const keep = Math.max(0, 1 - (spec.drag ?? 0) * dt);
  particle.vx = (particle.vx + (spec.windX ?? 0) * dt) * keep;
  particle.vy = (particle.vy + (spec.gravity ?? 0) * dt) * keep;
  if (spec.wobble !== undefined && spec.wobble > 0) {
    particle.x +=
      signedNoise(particle.ageMs / 160, particle.seed * 0.013, 0, particle.seed, { octaves: 1 }) *
      spec.wobble *
      dt;
  }
  particle.x += particle.vx * dt;
  particle.y += particle.vy * dt;
  if (spec.floor !== undefined && particle.y > spec.floor) {
    particle.y = spec.floor;
    const bounce = spec.bounce ?? 0;
    particle.vy = -particle.vy * bounce;
    particle.vx *= bounce > 0 ? 0.6 : 0;
  }
}

/** How many particles are alive. */
export function liveCount(pool: ParticlePool): number {
  return pool.particles.reduce((sum, particle) => sum + (particle.active ? 1 : 0), 0);
}

/** Retire every particle at once — a scene reset, not an effect ending. */
export function clearPool(pool: ParticlePool): void {
  for (const particle of pool.particles) {
    particle.active = false;
  }
}

/**
 * The live particles as lit pixels, offset by `(dx, dy)`.
 *
 * Each is inked from its ramp at a level eased from `levelFrom` to `levelTo`
 * over its life, and dithered out over the last `fade` of it. A size-2 particle
 * is a 2x2 block for the first half of its life and a single pixel after.
 */
export function particleCloud(pool: ParticlePool, dx = 0, dy = 0): PixelCloud {
  const cloud: PixelCloud = [];
  for (const particle of pool.particles) {
    if (particle.active) {
      pushParticle(cloud, particle, dx, dy);
    }
  }
  return cloud;
}

function pushParticle(cloud: PixelCloud, particle: Particle, dx: number, dy: number): void {
  const spec = particle.spec;
  const life = particle.ageMs / particle.lifeMs;
  const x = Math.round(particle.x + dx);
  const y = Math.round(particle.y + dy);
  const fade = spec.fade ?? 0.35;
  if (fade > 0 && life > 1 - fade) {
    const gone = (life - (1 - fade)) / fade;
    if (gone > ditherThreshold(x + particle.seed, y)) {
      return;
    }
  }
  const level = spec.levelFrom + (spec.levelTo - spec.levelFrom) * life;
  const ink = rampInk(spec.ramp, level, { x, y });
  cloud.push({ x, y, ink });
  if ((spec.size ?? 1) === 2 && life < 0.5) {
    cloud.push({ x: x + 1, y, ink }, { x, y: y - 1, ink }, { x: x + 1, y: y - 1, ink });
  }
}
