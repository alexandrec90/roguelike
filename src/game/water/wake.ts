/**
 * What walking through water does to it: a ring and a throw of spray at every
 * footfall, and a slow lap round the legs of anyone standing in it.
 *
 * Driven by distance, not by time - a footfall lands once per tile walked,
 * which is where the walk clip puts one (`walkClipMs`: two strides to a two-tile
 * cycle) - so the splashes keep step with the legs at any speed, and a wader who
 * stops stops splashing on the same frame. Pure: a wader's state, how far it
 * has walked and whether its foot is wet go in; the beat to play, if one fell
 * this frame, comes out. The rings are `ripples.ts`'s and the spray is the
 * general particle pool's (`fx/particles.ts`); the layer plays the beat.
 */

import type { ParticleSpec } from "../fx/particles";
import { translateCloud, type PixelCloud } from "../ink";
import { RAIN_RAMP } from "./rain";

/** Tiles walked between footfalls. */
export const STRIDE_TILES = 1;

/** How often the water laps round a wader standing still, ms. */
export const IDLE_LAP_MS = 1300;

/** A footfall's ring: wider and slower than a raindrop's. */
export const STEP_RING = { lifeMs: 1100, radius: 10 } as const;

/** The lap round a wader standing still: a slow, small ring. */
export const IDLE_RING = { lifeMs: 1500, radius: 7 } as const;

/** Spray per footfall. */
export const SPRAY_COUNT = 5;

const UP = -Math.PI / 2;

/** Spray kicked up by a foot: a crown higher and wider than a raindrop's, falling back fast. */
export const SPRAY_SPEC: ParticleSpec = {
  ramp: RAIN_RAMP,
  levelFrom: 1,
  levelTo: 0.35,
  lifeMs: [200, 360],
  speed: [0.035, 0.075],
  angle: [UP - 1.15, UP + 1.15],
  gravity: 0.0006,
  spreadX: 3,
  spreadY: 1,
  fade: 0.4,
};

/** One wader's memory between frames. */
export interface WakeState {
  /** The footfall it last splashed, or undefined while dry. */
  stride: number | undefined;
  /** How far it had walked last frame. */
  travelled: number;
  /** How long it has stood still in the water. */
  stillMs: number;
}

/** A footfall (`side` is which foot: -1 left, 1 right), or a lap round a wader standing still. */
export type WakeBeat = { readonly kind: "step"; readonly side: -1 | 1 } | { readonly kind: "lap" };

/**
 * The part of a foot-anchored cloud above water `rows` deep: y is 0 at the
 * sole and negative going up, so a row is hidden by being low.
 */
export function aboveWater(cloud: PixelCloud, rows: number): PixelCloud {
  return rows <= 0 ? cloud : cloud.filter((pixel) => pixel.y <= -rows);
}

/**
 * What water `rows` deep gives back of a wader: the part above it, mirrored
 * about the waterline - where its legs go in, `rows` up from its feet - rather
 * than about feet the water has hidden. As a reflectable: the cloud moved down
 * onto the waterline and the foot moved up to it, so the reflection reads it
 * like any other.
 */
export function waterlineReflection(
  cloud: PixelCloud,
  foot: { readonly x: number; readonly y: number },
  rows: number,
): { readonly cloud: PixelCloud; readonly foot: { readonly x: number; readonly y: number } } {
  if (rows <= 0) {
    return { cloud, foot };
  }
  return { cloud: translateCloud(cloud, 0, rows), foot: { x: foot.x, y: foot.y - rows } };
}

export function createWake(): WakeState {
  return { stride: undefined, travelled: 0, stillMs: 0 };
}

/**
 * Advance one wader a frame: `travelled` is the tiles it has walked in all,
 * `wet` whether its foot is in water now.
 *
 * Stepping into water is a footfall of its own - the first splash is the one
 * that says the ground changed.
 */
export function stepWake(state: WakeState, travelled: number, wet: boolean, deltaMs: number): WakeBeat | undefined {
  const moved = Math.abs(travelled - state.travelled) > 1e-6;
  state.travelled = travelled;
  const stride = Math.floor(travelled / STRIDE_TILES);
  if (!wet) {
    state.stride = undefined;
    state.stillMs = 0;
    return undefined;
  }
  const entering = state.stride === undefined;
  const footfall = state.stride !== stride;
  state.stride = stride;
  if (moved || entering) {
    state.stillMs = 0;
    return footfall ? { kind: "step", side: stride % 2 === 0 ? -1 : 1 } : undefined;
  }
  state.stillMs += Math.max(deltaMs, 0);
  if (state.stillMs >= IDLE_LAP_MS) {
    state.stillMs = 0;
    return { kind: "lap" };
  }
  return undefined;
}
