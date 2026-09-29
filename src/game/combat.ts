/**
 * A blow landing somewhere: the one shape every attack and every target share.
 *
 * The hero's sword, a fireball's blast and a frost nova all *produce* strikes;
 * slimes (and whatever comes after them) *receive* them. Neither side imports
 * the other — the scene hands one list to the other each frame — so a new
 * weapon needs no change to any enemy and a new enemy no change to any weapon.
 *
 * Strikes are in the **local frame** of the frame they were issued on: tiles
 * right of the hero (`x`) and ahead of him (`y`), the same frame `camera.ts`
 * draws from. A receiver holding planet coordinates converts its own position
 * with `toLocal(pose, point)` and compares there, which is exact: the local
 * frame is a rotation and translation of the planet's, so distances agree.
 */

import type { LocalPoint } from "./planet";

export type Element = "steel" | "fire" | "frost";

export interface Strike {
  /** Centre of the blow, local tiles. */
  readonly at: LocalPoint;
  /** Reach, tiles. Anything whose foot is within it is hit. */
  readonly radius: number;
  readonly damage: number;
  readonly element: Element;
  /**
   * Knockback, local tiles per second, as a direction and speed; absent means
   * "straight away from `at`", which is what a blast wants.
   */
  readonly push?: { readonly x: number; readonly y: number };
  /** How hard the knockback is when `push` is absent, tiles per second. */
  readonly force?: number;
}

/** Whether a point (local tiles) is inside a strike's reach. */
export function strikeHits(strike: Strike, point: LocalPoint): boolean {
  return Math.hypot(point.x - strike.at.x, point.y - strike.at.y) <= strike.radius;
}

/**
 * The knockback a strike gives a target at `point`, local tiles per second.
 *
 * Its own `push` when it has one (a sword cut shoves along the swing);
 * otherwise radial, away from the centre, falling off to half at the rim.
 */
export function strikePush(strike: Strike, point: LocalPoint): { x: number; y: number } {
  if (strike.push !== undefined) {
    return { x: strike.push.x, y: strike.push.y };
  }
  const dx = point.x - strike.at.x;
  const dy = point.y - strike.at.y;
  const distance = Math.hypot(dx, dy);
  const force = (strike.force ?? 4) * (1 - 0.5 * Math.min(distance / Math.max(strike.radius, 1e-6), 1));
  if (distance < 1e-6) {
    return { x: 0, y: force };
  }
  return { x: (dx / distance) * force, y: (dy / distance) * force };
}
