/**
 * The weather's wind: one signed field every plant in the world reads.
 *
 * Grass, a canopy, a willow frond, drifting embers and slanting rain all have
 * to agree, and they only agree if there is exactly one place the wind is
 * decided. That is here. `vegetation.ts`'s older `windOffset` is the previous,
 * narrower version of this idea — a pure sine — and the tree species in
 * `trees/` are built on this one instead.
 *
 * Two things separate this from a sine:
 *
 * - **Gusts.** The strength is an fBm envelope over time, so the field goes
 *   quiet and then leans hard for a couple of seconds. A constant-amplitude
 *   wind reads as a machine within about five seconds of watching it; a gust
 *   structure is most of what makes the same sway convincing.
 * - **A damped response.** A branch does not *follow* the wind, it is *driven*
 *   by it: `stepSway` integrates a spring, so the crown lags the gust,
 *   overshoots when it drops, and rings at its own natural frequency. That
 *   ringing is the single most valuable term in the whole vegetation stack,
 *   because it is the one a keyframe cannot fake.
 *
 * Everything except `stepSway` is a pure function of (elapsed, position, seed).
 * `stepSway` holds state because a spring is an integrator; it advances in
 * fixed slices so a capture reproduces regardless of frame rate.
 */

import { fbm3, signedNoise } from "./procgen/noise";
import { MAX_STEP_MS } from "./spark-emitter";

export const WIND_SEED = 0x51a7;

/** One fixed integration slice for the sway spring, in ms. */
export const SWAY_STEP_MS = 16;

export interface WindOptions {
  /** Peak displacement multiplier. 1 is a normal breezy day. */
  readonly strength?: number;
  /** 0 is a steady breeze, 1 is squalls with lulls between them. */
  readonly gustiness?: number;
  readonly seed?: number;
}

/**
 * How hard the wind is blowing right now, 0..1, everywhere at once.
 *
 * Kept separate from the direction field because plenty of things want the
 * envelope alone: a leaf's chance of tearing loose, how far rain slants, how
 * loudly a canopy hisses.
 */
export function gustAt(elapsedMs: number, options: WindOptions = {}): number {
  const gustiness = options.gustiness ?? 0.6;
  const seed = options.seed ?? WIND_SEED;
  // Two slow octaves, then a power curve: raising a 0..1 field to a power
  // pushes most of it toward zero and leaves rare peaks, which is what a lull
  // with occasional squalls actually looks like as a signal.
  const envelope = fbm3(0, 0, elapsedMs / 2600, seed + 7, { octaves: 2 });
  const shaped = envelope ** (1 + gustiness * 2.5);
  return (1 - gustiness) * 0.55 + gustiness * shaped * 1.6;
}

/**
 * The signed sideways wind at a point, roughly -1..1 before `strength`.
 *
 * Position enters as a phase offset rather than as an independent sample, so a
 * gust travels across a field of grass as a visible wave instead of every tuft
 * flinching at once. `x` and `y` are in logical pixels.
 */
export function windAt(elapsedMs: number, x = 0, y = 0, options: WindOptions = {}): number {
  const strength = options.strength ?? 1;
  const seed = options.seed ?? WIND_SEED;
  const gust = gustAt(elapsedMs, options);
  // The travelling term: subtracting x from time is what moves the wave
  // downwind. The divisor is the wavelength in pixels.
  const travel = elapsedMs / 900 - x / 46 - y / 90;
  const carrier = Math.sin(travel * 1.7);
  const turbulence = signedNoise(x / 22, y / 30, elapsedMs / 520, seed, { octaves: 2 });
  return strength * gust * (0.68 * carrier + 0.42 * turbulence);
}

export interface SwayConfig {
  /** Natural frequency in Hz. A sapling is near 1.2, a heavy limb near 0.4. */
  readonly frequency: number;
  /** 0 rings forever, 1 is critically damped and never overshoots. */
  readonly damping: number;
  /** How hard the wind drives this particular limb. */
  readonly response: number;
}

export interface Sway {
  readonly config: SwayConfig;
  /** Current displacement, in whatever unit `response` was scaled to. */
  angle: number;
  velocity: number;
  accumulatorMs: number;
}

export const DEFAULT_SWAY: SwayConfig = { frequency: 0.55, damping: 0.22, response: 1 };

export function createSway(overrides: Partial<SwayConfig> = {}): Sway {
  const config: SwayConfig = { ...DEFAULT_SWAY, ...overrides };
  if (config.frequency <= 0) {
    throw new Error("Sway frequency must be greater than zero");
  }
  if (config.damping < 0 || config.damping > 1) {
    throw new Error("Sway damping must be between 0 and 1");
  }
  return { config, angle: 0, velocity: 0, accumulatorMs: 0 };
}

/**
 * Drive the spring with a wind sample and advance it.
 *
 * Semi-implicit Euler in fixed slices: stable at these frequencies, and the
 * fixed slice is what makes two runs at different frame rates land on the same
 * pixel. Returns the settled displacement so callers rarely touch the state.
 */
export function stepSway(sway: Sway, dtMs: number, drive: number): number {
  const omega = 2 * Math.PI * sway.config.frequency;
  const stiffness = omega * omega;
  const friction = 2 * sway.config.damping * omega;
  const target = drive * sway.config.response;

  sway.accumulatorMs += Math.min(Math.max(dtMs, 0), MAX_STEP_MS);
  while (sway.accumulatorMs >= SWAY_STEP_MS) {
    sway.accumulatorMs -= SWAY_STEP_MS;
    const dt = SWAY_STEP_MS / 1000;
    const acceleration = stiffness * (target - sway.angle) - friction * sway.velocity;
    sway.velocity += acceleration * dt;
    sway.angle += sway.velocity * dt;
  }
  return sway.angle;
}

export function resetSway(sway: Sway): void {
  sway.angle = 0;
  sway.velocity = 0;
  sway.accumulatorMs = 0;
}
