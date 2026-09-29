/**
 * What a drop does when it hits the grass: a tiny crown of spray.
 *
 * Two or three pixels thrown up and out, pulled back by gravity, dithered away
 * within a fifth of a second — the general particle pool (`fx/particles.ts`)
 * with a spec, not a drawn splash. The near sheet's drops throw a wider, taller
 * crown than the mid sheet's, and the far sheet's are a single pixel's blink,
 * because a splash is as far away as the drop that made it.
 *
 * A drop that lands in water does not splash: it rings the puddle instead
 * (`rainImpact` → `ripples.ts`), and the layer decides which.
 */

import { emit, type ParticlePool, type ParticleSpec } from "../fx/particles";
import type { RainSheet } from "./rain";
import { RAIN_RAMP } from "./rain";

const UP = -Math.PI / 2;

/** One crown per sheet, far to near. */
export const SPLASH_SPECS: readonly [ParticleSpec, ParticleSpec, ParticleSpec] = [
  {
    ramp: RAIN_RAMP,
    levelFrom: 0.5,
    levelTo: 0.3,
    lifeMs: [60, 110],
    speed: [0, 0.004],
    angle: [UP - 1, UP + 1],
    fade: 0.5,
  },
  {
    ramp: RAIN_RAMP,
    levelFrom: 0.8,
    levelTo: 0.35,
    lifeMs: [120, 190],
    speed: [0.025, 0.045],
    angle: [UP - 1.1, UP + 1.1],
    gravity: 0.00055,
    fade: 0.45,
  },
  {
    ramp: RAIN_RAMP,
    levelFrom: 1,
    levelTo: 0.4,
    lifeMs: [150, 240],
    speed: [0.035, 0.065],
    angle: [UP - 1.2, UP + 1.2],
    gravity: 0.0006,
    fade: 0.4,
  },
];

/** Particles per splash, far to near. */
export const SPLASH_COUNTS: readonly [number, number, number] = [1, 2, 3];

/** Throw one drop's crown into `pool` at (x, y). */
export function emitSplash(pool: ParticlePool, sheet: RainSheet, x: number, y: number): void {
  emit(pool, SPLASH_SPECS[sheet], SPLASH_COUNTS[sheet], x, y - 1);
}
