/**
 * Seeded value noise, fBm, and the flow field built out of them.
 *
 * Everything that should look *organic* rather than *drawn* — a canopy boiling
 * at its silhouette, smoke wandering, leaves caught in a current — is a
 * threshold or an advection over one of these functions. They are the "noise"
 * and "field" primitives named in `procedural-effects.md`, and like every other
 * effect primitive here they are pure functions of their arguments: the same
 * (x, y, t, seed) gives the same scalar on every run, in every test, in the
 * asset lab and in the game.
 *
 * Value noise rather than gradient (Perlin/simplex) noise on purpose. At this
 * pixel scale the two are indistinguishable once quantised to a four-step ink
 * ramp, and value noise is a lattice hash plus a smoothstep — no gradient
 * table, no permutation array, nothing to keep seeded consistently across a
 * reload. If a future effect genuinely needs the directional character of
 * simplex noise, that is a new function here, not a new opinion elsewhere.
 */

import { pixelHash } from "../transforms";

/** Hermite smoothstep. The interpolant that makes lattice noise look continuous. */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth seeded noise over the plane, 0..1. One unit is one lattice cell. */
export function valueNoise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const c00 = pixelHash(ix, iy, seed);
  const c10 = pixelHash(ix + 1, iy, seed);
  const c01 = pixelHash(ix, iy + 1, seed);
  const c11 = pixelHash(ix + 1, iy + 1, seed);
  return mix(mix(c00, c10, fx), mix(c01, c11, fx), fy);
}

/**
 * The same field with a third axis, 0..1.
 *
 * The third axis is almost always time: sampling `valueNoise3(x, y, t, seed)`
 * is how a static pattern becomes one that *evolves* in place, as opposed to
 * one that merely slides past (which is what adding a scrolled offset to the
 * 2D field gives, and is a different, also useful, effect).
 */
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const iz = Math.floor(z);
  const fz = fade(z - iz);
  // Two 2D layers a lattice step apart, blended. Salting the seed with the
  // layer index is what makes them independent rather than a repeat.
  const lower = valueNoise2(x, y, seed ^ Math.imul(iz, 0x9e3779b9));
  const upper = valueNoise2(x, y, seed ^ Math.imul(iz + 1, 0x9e3779b9));
  return mix(lower, upper, fz);
}

export interface FbmOptions {
  readonly octaves?: number;
  /** Frequency multiplier per octave. 2 is the usual doubling. */
  readonly lacunarity?: number;
  /** Amplitude multiplier per octave. 0.5 gives the classic 1/f falloff. */
  readonly gain?: number;
}

/**
 * Fractional Brownian motion: octaves of the field summed at halving amplitude
 * and doubling frequency, normalised back to 0..1.
 *
 * One octave is a soft blob field; three is cloud; five is rock. This is the
 * knob that decides whether a canopy reads as a mass of leaves or as a bag.
 */
export function fbm3(
  x: number,
  y: number,
  z: number,
  seed: number,
  options: FbmOptions = {},
): number {
  const octaves = Math.max(1, Math.trunc(options.octaves ?? 3));
  const lacunarity = options.lacunarity ?? 2;
  const gain = options.gain ?? 0.5;

  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * valueNoise3(x * frequency, y * frequency, z * frequency, seed + octave * 101);
    total += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return total === 0 ? 0 : sum / total;
}

/** fBm with the time axis pinned — the still version of the same field. */
export function fbm2(x: number, y: number, seed: number, options: FbmOptions = {}): number {
  return fbm3(x, y, 0, seed, options);
}

export interface Flow {
  readonly x: number;
  readonly y: number;
}

/**
 * A divergence-free 2D flow field: the curl of a scalar fBm potential.
 *
 * Taking the perpendicular gradient rather than the gradient itself is what
 * makes the result *swirl* instead of *converge*. Particles pushed by a plain
 * noise gradient all pile into the same wells within a second and the effect
 * dies; particles pushed by a curl field circulate indefinitely, which is what
 * leaves in an eddy, smoke and drifting embers actually do.
 *
 * Returned unnormalised, roughly unit-scaled. Multiply by a speed.
 */
export function curlFlow(x: number, y: number, t: number, seed: number, epsilon = 0.5): Flow {
  const north = fbm3(x, y - epsilon, t, seed);
  const south = fbm3(x, y + epsilon, t, seed);
  const west = fbm3(x - epsilon, y, t, seed);
  const east = fbm3(x + epsilon, y, t, seed);
  const scale = 1 / (2 * epsilon);
  // Perpendicular gradient: (dP/dy, -dP/dx).
  return { x: (south - north) * scale, y: -(east - west) * scale };
}

/**
 * Signed noise in -1..1, which is what a *displacement* wants.
 *
 * The 0..1 form is right for a threshold or a ramp level; using it for an
 * offset biases everything one way, and a canopy that only ever leans right is
 * the most common symptom of the two being confused.
 */
export function signedNoise(
  x: number,
  y: number,
  z: number,
  seed: number,
  options?: FbmOptions,
): number {
  return fbm3(x, y, z, seed, options) * 2 - 1;
}
