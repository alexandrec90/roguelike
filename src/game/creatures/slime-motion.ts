/**
 * How a slime moves: a committed hop, and the spring that makes it jelly.
 *
 * Two terms, summed the way `CLAUDE.md` asks every animation to be — a base
 * shape plus functions of time, not frames:
 *
 * - **The hop** is a ballistic arc with its three beats spelled out: a squat
 *   of anticipation on the ground, a flight that covers the whole distance,
 *   and a landing that the body has to absorb. Committed, like the hero's
 *   step: once a slime has decided to hop it goes, which is what makes it
 *   readable and dodgeable.
 * - **The squash** is a damped spring on the body's vertical scale. The hop
 *   never sets the shape directly; it only pulls the spring's target and kicks
 *   its velocity — stretch at take-off, a slap of compression on landing — and
 *   the wobble afterwards is the spring settling, for free, with no keyframe
 *   for it anywhere.
 *
 * Everything here is pure arithmetic over milliseconds, so a hop is the same
 * hop in a test, in the lab and in the game.
 */

/** The three beats of a hop, ms. */
export const HOP_WINDUP_MS = 150;
export const HOP_AIR_MS = 430;
export const HOP_LAND_MS = 170;
export const HOP_TOTAL_MS = HOP_WINDUP_MS + HOP_AIR_MS + HOP_LAND_MS;

/** How far a hop may carry, tiles. */
export const HOP_MIN = 0.6;
export const HOP_MAX = 1.2;

/** Peak lift of a hop, logical pixels, before its length adds to it. */
export const HOP_HEIGHT = 5;

/** The largest squash or stretch the body may show, either way. */
export const MAX_SQUASH = 0.42;

/** Spring stiffness (rad/s) and damping ratio: a quick, under-damped jelly. */
const SPRING_OMEGA = 2 * Math.PI * 5.2;
const SPRING_DAMPING = 0.24;

/** The longest slice the spring integrates at once, so a slow frame cannot explode it. */
const SPRING_SLICE_MS = 8;

export interface Spring {
  value: number;
  velocity: number;
}

export function createSpring(): Spring {
  return { value: 0, velocity: 0 };
}

/**
 * Advance a spring toward `target` by `deltaMs`.
 *
 * Semi-implicit Euler in short slices: stable at this stiffness for any frame
 * length, and exactly repeatable for the same sequence of deltas.
 */
export function stepSpring(spring: Spring, target: number, deltaMs: number): void {
  let remaining = Math.min(Math.max(deltaMs, 0), 200);
  while (remaining > 0) {
    const sliceMs = Math.min(remaining, SPRING_SLICE_MS);
    remaining -= sliceMs;
    const dt = sliceMs / 1000;
    const accel =
      -SPRING_OMEGA * SPRING_OMEGA * (spring.value - target) -
      2 * SPRING_DAMPING * SPRING_OMEGA * spring.velocity;
    spring.velocity += accel * dt;
    spring.value = Math.min(Math.max(spring.value + spring.velocity * dt, -MAX_SQUASH), MAX_SQUASH);
  }
}

export type HopBeat = "windup" | "air" | "land" | "done";

/** Which beat of a hop `ms` falls in, and how far through that beat, 0..1. */
export function hopBeat(ms: number): { readonly beat: HopBeat; readonly t: number } {
  if (ms < HOP_WINDUP_MS) {
    return { beat: "windup", t: Math.max(ms, 0) / HOP_WINDUP_MS };
  }
  if (ms < HOP_WINDUP_MS + HOP_AIR_MS) {
    return { beat: "air", t: (ms - HOP_WINDUP_MS) / HOP_AIR_MS };
  }
  if (ms < HOP_TOTAL_MS) {
    return { beat: "land", t: (ms - HOP_WINDUP_MS - HOP_AIR_MS) / HOP_LAND_MS };
  }
  return { beat: "done", t: 1 };
}

/** A parabola: 0 at both ends, `height` at the middle. */
export function arcLift(t: number, height: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return 4 * height * clamped * (1 - clamped);
}

/** A longer hop goes higher, so a lunge reads as effort. */
export function hopHeight(distance: number): number {
  return HOP_HEIGHT + distance * 3;
}

/**
 * Where the squash spring is being pulled during a hop.
 *
 * Squat while winding up; stretched tall on the way up, easing toward round
 * at the top of the arc and stretching again into the fall; back to rest on
 * the ground. The landing's compression is not a target — it is the kick
 * `LANDING_KICK` gives the velocity, which is why it overshoots and wobbles.
 */
export function hopSquashTarget(ms: number): number {
  const { beat, t } = hopBeat(ms);
  if (beat === "windup") {
    return -0.34 * Math.min(1, t * 1.6);
  }
  if (beat === "air") {
    return 0.22 * Math.abs(1 - 2 * t) + 0.04;
  }
  return 0;
}

/** Velocity kicks, squash units per second. */
export const TAKEOFF_KICK = 7;
export const LANDING_KICK = -9;
export const HIT_KICK = -6;
