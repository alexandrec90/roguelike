/**
 * A pooled, seeded ember emitter.
 *
 * Two properties matter more than the motion itself. The pool is fixed, so a
 * long session cannot grow its particle count; and the randomness is seeded, so
 * the same emitter stepped by the same deltas produces the same pixels every
 * time. Without the second property the asset lab cannot compare two captures
 * of an effect, and "it looks different" never distinguishes a regression from
 * a die roll.
 *
 * The state is mutated in place rather than rebuilt each frame: this runs in
 * the render loop, and a fresh array of particles per frame is garbage the
 * collector has to chase during animation.
 */

export interface EmitterConfig {
  /** Fixed pool size. Spawns are dropped when every slot is alive. */
  readonly capacity: number;
  readonly seed: number;
  readonly spawnIntervalMs: number;
  readonly spawnJitterMs: number;
  readonly lifeMs: number;
  readonly lifeJitterMs: number;
  readonly originX: number;
  readonly originY: number;
  /** Half-width and half-height of the spawn box around the origin. */
  readonly spreadX: number;
  readonly spreadY: number;
  /** Horizontal drift in logical pixels per millisecond, applied as +/- range. */
  readonly driftX: number;
  /** Upward speed in logical pixels per millisecond. */
  readonly riseY: number;
}

export interface SparkParticle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageMs: number;
  lifeMs: number;
}

export interface EmitterState {
  readonly config: EmitterConfig;
  readonly particles: SparkParticle[];
  untilNextSpawnMs: number;
  rngState: number;
}

export const DEFAULT_EMITTER: EmitterConfig = {
  capacity: 14,
  seed: 0x9e3779b9,
  spawnIntervalMs: 120,
  spawnJitterMs: 170,
  lifeMs: 420,
  lifeJitterMs: 220,
  originX: 160,
  originY: 62,
  spreadX: 3,
  spreadY: 1,
  driftX: 0.0022,
  riseY: 0.0085,
};

/**
 * Longest delta a single step will integrate.
 *
 * A backgrounded tab hands the next frame a multi-second delta; without this
 * every ember would teleport off screen and the spawn loop would fire dozens of
 * times in one call.
 */
export const MAX_STEP_MS = 100;

export function createEmitter(overrides: Partial<EmitterConfig> = {}): EmitterState {
  const config: EmitterConfig = { ...DEFAULT_EMITTER, ...overrides };
  if (!Number.isInteger(config.capacity) || config.capacity < 1) {
    throw new Error("Emitter capacity must be a positive integer");
  }
  if (config.spawnIntervalMs <= 0) {
    throw new Error("Emitter spawn interval must be greater than zero");
  }
  if (config.lifeMs <= 0) {
    throw new Error("Emitter particle life must be greater than zero");
  }

  const particles: SparkParticle[] = [];
  for (let index = 0; index < config.capacity; index += 1) {
    particles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, ageMs: 0, lifeMs: 0 });
  }

  return { config, particles, untilNextSpawnMs: 0, rngState: config.seed >>> 0 };
}

/** Return an emitter to the state `createEmitter` gave it, seed included. */
export function resetEmitter(state: EmitterState): void {
  for (const particle of state.particles) {
    // Every field, not just `active`: a reset that leaves the last run's
    // coordinates behind makes two replays of the same seek differ in whatever
    // reads a retired slot, which is the one thing a seek exists to rule out.
    particle.active = false;
    particle.ageMs = 0;
    particle.lifeMs = 0;
    particle.x = 0;
    particle.y = 0;
    particle.vx = 0;
    particle.vy = 0;
  }
  state.untilNextSpawnMs = 0;
  state.rngState = state.config.seed >>> 0;
}

export function stepEmitter(state: EmitterState, deltaMs: number): void {
  const delta = Math.min(Math.max(deltaMs, 0), MAX_STEP_MS);
  if (delta === 0) {
    return;
  }

  for (const particle of state.particles) {
    if (!particle.active) {
      continue;
    }
    particle.ageMs += delta;
    if (particle.ageMs >= particle.lifeMs) {
      particle.active = false;
      continue;
    }
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
  }

  state.untilNextSpawnMs -= delta;
  while (state.untilNextSpawnMs <= 0) {
    spawn(state);
    const jitter = nextFloat(state) * state.config.spawnJitterMs;
    state.untilNextSpawnMs += state.config.spawnIntervalMs + jitter;
  }
}

/** Linear fade over a particle's life, clamped to [0, 1]. */
export function particleAlpha(particle: SparkParticle): number {
  if (!particle.active || particle.lifeMs <= 0) {
    return 0;
  }
  return Math.min(Math.max(1 - particle.ageMs / particle.lifeMs, 0), 1);
}

function spawn(state: EmitterState): void {
  const slot = state.particles.find((particle) => !particle.active);
  if (slot === undefined) {
    // The pool is the cap: dropping the spawn is the intended behaviour, not a
    // failure to report. The caller still advances the rng for the next spawn
    // delay, so the schedule stays reproducible either way.
    return;
  }

  const { config } = state;
  slot.active = true;
  slot.ageMs = 0;
  slot.lifeMs = config.lifeMs + nextFloat(state) * config.lifeJitterMs;
  slot.x = config.originX + (nextFloat(state) * 2 - 1) * config.spreadX;
  slot.y = config.originY + (nextFloat(state) * 2 - 1) * config.spreadY;
  slot.vx = (nextFloat(state) * 2 - 1) * config.driftX;
  slot.vy = -config.riseY;
}

/** mulberry32 — small, fast, and good enough for sparks; not for anything secret. */
function nextFloat(state: EmitterState): number {
  state.rngState = (state.rngState + 0x6d2b79f5) >>> 0;
  let z = state.rngState;
  z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
}
