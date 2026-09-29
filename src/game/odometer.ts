/**
 * How far the ground has slid under the hero, in pixels, since the session
 * began — for the few things that ride on the ground without being *of* it.
 *
 * A puddle or a scorch mark is a planet feature and is placed through the
 * camera like anything else. A cloud's shadow, a drift of pollen or a swarm of
 * fireflies is not a place: it has no planet point worth keeping, it only has
 * to move *with the ground* as the hero walks, or it reads as stuck to the
 * glass. This is the one number such things need: the scroll, accumulated.
 *
 * The scroll phase runs 0 → 1 over a step and snaps back as the pose advances,
 * so the odometer reads the phase's change each frame and, on the frame the
 * pose moved on, adds back the whole tile the snap took away.
 */

import { TILE_DEPTH, TILE_WIDTH } from "./projection";

export interface Odometer {
  /** Accumulated screen travel of the ground, logical pixels. */
  x: number;
  y: number;
  lastPhaseX: number;
  lastPhaseY: number;
  lastPose: unknown;
}

export function createOdometer(): Odometer {
  return { x: 0, y: 0, lastPhaseX: 0, lastPhaseY: 0, lastPose: undefined };
}

/**
 * Advance by this frame's phase (tiles) and pose. The ground moves opposite
 * the hero: walking right (phase +x) slides it left on screen, walking ahead
 * (phase +y) slides it down.
 */
export function trackScroll(
  odometer: Odometer,
  phase: { readonly x: number; readonly y: number },
  pose: unknown,
): void {
  let dx = phase.x - odometer.lastPhaseX;
  let dy = phase.y - odometer.lastPhaseY;
  if (odometer.lastPose !== undefined && pose !== odometer.lastPose) {
    // The step landed: the phase snapped back by a tile the ground really did
    // travel, in whichever direction it had been running.
    dx += Math.sign(odometer.lastPhaseX);
    dy += Math.sign(odometer.lastPhaseY);
  }
  odometer.x -= dx * TILE_WIDTH;
  odometer.y += dy * TILE_DEPTH;
  odometer.lastPhaseX = phase.x;
  odometer.lastPhaseY = phase.y;
  odometer.lastPose = pose;
}
