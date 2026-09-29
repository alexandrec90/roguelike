/**
 * The burning blade: flame licks, embers and the light it throws.
 *
 * Nothing here is a drawn flame. A lick is a pooled particle (`fx/particles.ts`)
 * born somewhere along the blade's current segment, handed a share of the
 * blade's own velocity so a swing flings fire off its edge, then left to rise
 * on buoyancy, wander on noise and cool down the fire ramp until the dither
 * eats it. Embers are the same pool with a longer life and a wider cone. The
 * light is a `LightSource` at the blade's middle, breathing on `flicker`, so
 * the grass around him goes orange when the sword does.
 *
 * All coordinates are foot-relative screen pixels, the hero's own frame.
 */

import type { LightSource } from "../lights";
import { flicker } from "../lights";
import { emit, type ParticlePool, type ParticleSpec } from "../fx/particles";
import { familyHex } from "../palette";
import { INK_RAMPS } from "../shading";
import { pixelHash } from "../transforms";

export interface BladeSegment {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
}

/** A tongue of flame off the edge: short, bright, rising, curling. */
export const FLAME_LICK: ParticleSpec = {
  ramp: INK_RAMPS.fire,
  levelFrom: 1,
  levelTo: 0.2,
  lifeMs: [150, 320],
  speed: [0.004, 0.018],
  angle: [-Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55],
  gravity: -0.00016,
  drag: 0.006,
  wobble: 0.014,
  spreadX: 0.6,
  spreadY: 0.6,
  fade: 0.45,
  size: 1,
};

/** A fat lick, the core of the flame: a 2x2 that shrinks to a pixel. */
export const FLAME_CORE: ParticleSpec = { ...FLAME_LICK, levelFrom: 0.95, levelTo: 0.45, lifeMs: [90, 170], size: 2 };

/** A spark that outlives the flame and drifts off on the air. */
export const EMBER: ParticleSpec = {
  ramp: INK_RAMPS.fire,
  levelFrom: 0.95,
  levelTo: 0.45,
  lifeMs: [420, 820],
  speed: [0.012, 0.04],
  angle: [-Math.PI / 2 - 1.1, -Math.PI / 2 + 1.1],
  gravity: -0.00004,
  drag: 0.002,
  wobble: 0.022,
  fade: 0.5,
};

/** Licks per millisecond of burning: about four a frame at 60 fps. */
export const LICKS_PER_MS = 0.26;
/** Embers per millisecond: one every ~110 ms. */
export const EMBERS_PER_MS = 0.009;
/** How much of the blade's own motion a newborn lick keeps. */
export const INHERIT = 0.35;

/** A light the colour of the flame's orange middle, never a hex written here. */
const BLADE_LIGHT_COLOR = familyHex("fire-5");
const LIGHT_SEED = 0xf1a3;

export interface FireEmitter {
  /** Fractional particles owed from previous frames, so a slow frame is not a sparse one. */
  lickDebt: number;
  emberDebt: number;
  readonly seed: number;
}

export function createFireEmitter(seed: number): FireEmitter {
  return { lickDebt: 0, emberDebt: 0, seed };
}

/**
 * Emit this frame's licks and embers along the blade.
 *
 * Where along the blade each one is born is hashed from the pool's draw
 * counter, so the same pool stepped the same way makes the same fire. The
 * count is carried as debt between frames so the rate is exact at any frame
 * rate. `velocity` is the blade's own, px/ms.
 */
export function emitBladeFire(
  pool: ParticlePool,
  emitter: FireEmitter,
  blade: BladeSegment,
  deltaMs: number,
  velocity: { readonly x: number; readonly y: number },
): void {
  const delta = Math.min(Math.max(deltaMs, 0), 50);
  emitter.lickDebt += delta * LICKS_PER_MS;
  emitter.emberDebt += delta * EMBERS_PER_MS;
  const options = { inheritX: velocity.x * INHERIT, inheritY: velocity.y * INHERIT };
  while (emitter.lickDebt >= 1) {
    emitter.lickDebt -= 1;
    const t = pixelHash(pool.draws, 7, emitter.seed);
    const spec = pixelHash(pool.draws, 8, emitter.seed) < 0.25 ? FLAME_CORE : FLAME_LICK;
    emit(pool, spec, 1, blade.ax + (blade.bx - blade.ax) * t, blade.ay + (blade.by - blade.ay) * t, options);
  }
  while (emitter.emberDebt >= 1) {
    emitter.emberDebt -= 1;
    const t = 0.3 + pixelHash(pool.draws, 9, emitter.seed) * 0.7;
    emit(pool, EMBER, 1, blade.ax + (blade.bx - blade.ax) * t, blade.ay + (blade.by - blade.ay) * t, options);
  }
}

/** A burst off the blade when it lands a blow: sparks, or flame if it burns. */
export const HIT_SPARK: ParticleSpec = {
  ramp: INK_RAMPS.metal,
  levelFrom: 1,
  levelTo: 0.55,
  lifeMs: [90, 200],
  speed: [0.05, 0.12],
  angle: [-Math.PI, Math.PI],
  gravity: 0.0003,
  drag: 0.01,
  fade: 0.4,
};

export function emitHitBurst(pool: ParticlePool, x: number, y: number, burning: boolean): void {
  emit(pool, burning ? { ...HIT_SPARK, ramp: INK_RAMPS.fire } : HIT_SPARK, 9, x, y);
}

/** The blade's light, at its middle, in screen pixels. */
export function bladeLight(
  blade: BladeSegment,
  footX: number,
  footY: number,
  elapsedMs: number,
): LightSource {
  return {
    x: Math.round(footX + (blade.ax + blade.bx) / 2),
    y: Math.round(footY + (blade.ay + blade.by) / 2),
    radius: 46,
    color: BLADE_LIGHT_COLOR,
    intensity: 0.9 * flicker(elapsedMs, LIGHT_SEED),
  };
}
