/**
 * The drawn turn: how the rig's yaw follows the simulation's facing.
 *
 * Facing itself is immediate — `player.ts` re-reads it every frame, and a blow
 * or a spell leaves along it the instant it is asked for. What this eases is
 * only the picture, so a keyboard about-face or a flick of the cursor across
 * him sweeps the rig round over a few frames instead of cutting from one view
 * to the next. The sweep starts on the same frame as the input, so the turn
 * still reads as the game hearing him; it just does not teleport.
 *
 * A term, not a frame set: the rig turns to any yaw for the cost of one, which
 * is the whole reason this costs nothing to draw.
 */

/**
 * The ease's time constant, ms. After one constant the rig has covered 63% of
 * the turn, after three 95% — so a half turn reads as a sweep at 60 fps and is
 * done in about a tenth of a second.
 */
export const TURN_EASE_MS = 35;

/** Under this many radians the rig lands on the facing exactly, so a still hero is still. */
export const TURN_SETTLE = 0.01;

/** The shortest signed turn from `from` to `to`, in [-π, π). */
export function turnBetween(from: number, to: number): number {
  const full = 2 * Math.PI;
  return ((((to - from + Math.PI) % full) + full) % full) - Math.PI;
}

/**
 * The drawn yaw after `deltaMs` more of chasing `target` the short way round.
 *
 * Exponential, so a frame's share depends only on how long the frame was: a
 * slow frame turns further rather than lagging, and a fixed-step capture
 * repeats exactly.
 */
export function easeYaw(shown: number, target: number, deltaMs: number, easeMs: number = TURN_EASE_MS): number {
  const remaining = turnBetween(shown, target);
  if (Math.abs(remaining) < TURN_SETTLE || easeMs <= 0) {
    return target;
  }
  const share = 1 - Math.exp(-Math.max(deltaMs, 0) / easeMs);
  return shown + remaining * share;
}
