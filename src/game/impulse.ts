/**
 * Impulse: screen shake and hit stop, as scalars over time.
 *
 * The ninth primitive in `procedural-effects.md`. A blow that lands should be
 * *felt* — a two-pixel jolt of the camera and a few frames where the world
 * holds its breath — and both are the same shape: a kick that decays. Anything
 * may kick; only the scene reads the result, once per frame, and applies it.
 *
 * Deterministic: the shake offset is a seeded function of the impulse's own
 * clock, never `Math.random`, so a capture of an explosion reproduces.
 */

import { pixelHash } from "./transforms";

/** The largest shake anything may ask for, logical pixels. */
export const MAX_SHAKE = 4;

/** The longest the world may freeze for, ms — longer reads as a hitch. */
export const MAX_HIT_STOP_MS = 120;

export interface ImpulseState {
  /** Current shake amplitude, pixels; decays toward 0. */
  shake: number;
  /** How fast the shake decays, amplitude per ms. */
  decay: number;
  /** Remaining frozen time, ms. */
  stopMs: number;
  /** The impulse's own clock, which the shake pattern is hashed from. */
  clockMs: number;
}

/** What an effect is handed so it can kick the camera without owning it. */
export interface ImpulseSink {
  /** Shake by `amount` pixels, dying away over `durationMs`. */
  shake(amount: number, durationMs?: number): void;
  /** Freeze the world for `ms`. */
  hitStop(ms: number): void;
}

export function createImpulse(): ImpulseState {
  return { shake: 0, decay: 0, stopMs: 0, clockMs: 0 };
}

export function kickShake(state: ImpulseState, amount: number, durationMs = 220): void {
  const capped = Math.min(Math.max(amount, 0), MAX_SHAKE);
  if (capped <= state.shake) {
    return;
  }
  state.shake = capped;
  state.decay = capped / Math.max(durationMs, 1);
}

export function kickHitStop(state: ImpulseState, ms: number): void {
  state.stopMs = Math.min(Math.max(state.stopMs, ms), MAX_HIT_STOP_MS);
}

/** A sink that writes into `state` — what the scene hands to every layer. */
export function impulseSink(state: ImpulseState): ImpulseSink {
  return {
    shake: (amount, durationMs) => kickShake(state, amount, durationMs),
    hitStop: (ms) => kickHitStop(state, ms),
  };
}

/**
 * Advance the impulse by a real (unfrozen) delta, and return how much of that
 * delta the *world* should see: all of it, or none while a hit stop holds.
 */
export function stepImpulse(state: ImpulseState, deltaMs: number): number {
  const delta = Math.max(deltaMs, 0);
  state.clockMs += delta;
  state.shake = Math.max(0, state.shake - state.decay * delta);
  if (state.stopMs <= 0) {
    return delta;
  }
  const frozen = Math.min(state.stopMs, delta);
  state.stopMs -= frozen;
  return delta - frozen;
}

/** The camera offset this instant: whole pixels, never a fraction. */
export function shakeOffset(state: ImpulseState): { readonly x: number; readonly y: number } {
  if (state.shake < 0.5) {
    return { x: 0, y: 0 };
  }
  // Re-rolled every 32 ms rather than every frame, so a shake reads as a jolt
  // and not as a blur, and a capture at a fixed time is repeatable.
  const tick = Math.floor(state.clockMs / 32);
  return {
    x: Math.round((pixelHash(tick, 0, 0x5a4e) * 2 - 1) * state.shake),
    y: Math.round((pixelHash(tick, 1, 0x5a4e) * 2 - 1) * state.shake * 0.6),
  };
}
