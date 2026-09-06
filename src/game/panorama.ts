/**
 * The horizon as a loop: one full turn of distant world, scrolled by the
 * heading.
 *
 * This is where the round planet is actually legible. The ground can only turn
 * in whole tiles - it is a grid, and `terrain.ts` explains why that is the right
 * trade - but the horizon has no grid, no foreshortening and no seams to keep
 * square, so it is free to sweep by the exact angle, in whole pixels, every
 * frame. Strafe and the ridge glides; keep strafing and it comes all the way
 * round and meets itself.
 *
 *      turn = 0                       turn = pi                   turn = 2 pi
 *      +--------+                     +--------+                  +--------+
 *      | /\  /\ |  ...scrolls left... | ^   __ |  ...and back...  | /\  /\ |
 *      +--------+                     +--------+                  +--------+
 *       |<- 320 px of a 1280 px panorama; 4 screens make one lap ->|
 *
 * `PANORAMA_WIDTH / 320` is the only framing decision in the file: four screens
 * to a turn, so the render target sees 90 degrees at once. Widen it and the
 * world feels vast and turns slowly; narrow it and every step swings the sky.
 *
 * Two things have to be true for the loop to close, and both are easy to lose:
 *
 * - **The ridge noise must wrap.** `ridgeProfile`'s `period` folds its lattice
 *   modulo its own cell count so column 1279 meets column 0 exactly. Generating
 *   1280 columns of *open* noise looks identical on screen and puts a cliff at
 *   one bearing, once a lap - the kind of fault a unit test finds and an
 *   eyeball does not.
 * - **Landmarks are bearings, not screen positions.** A pine lives at a column
 *   of the panorama forever; `landmarkX` says where that lands on screen right
 *   now, or returns something far off the edge when the answer is "behind you".
 */

import { ridgeProfile, type RidgeOptions } from "./horizon";

const TAU = Math.PI * 2;

/** Logical pixels in one full turn of horizon. Four render targets to a lap. */
export const PANORAMA_WIDTH = 1280;

/** Fold a panorama column into `[0, PANORAMA_WIDTH)`. */
export function wrapPanorama(x: number): number {
  const wrapped = x % PANORAMA_WIDTH;
  return wrapped < 0 ? wrapped + PANORAMA_WIDTH : wrapped;
}

/**
 * How far the panorama has scrolled, in whole pixels, for a heading.
 *
 * Rounded here rather than at each draw call, so the ridge, the stars and every
 * landmark move by the same integer on the same frame. Rounding independently
 * would let a pine drift a pixel against the ridge it is standing on.
 */
export function bearingOffset(turn: number): number {
  return wrapPanorama(Math.round((turn / TAU) * PANORAMA_WIDTH));
}

/** Which panorama column a screen column is showing. */
export function panoramaColumn(screenX: number, offset: number): number {
  return wrapPanorama(screenX + offset);
}

/**
 * Screen x of a landmark that lives at panorama column `at`.
 *
 * Signed and centred on the viewer, so "just off the left edge" reads as a small
 * negative rather than as 1200-and-therefore-visible: a caller keeps whatever
 * falls inside its own width plus the sprite's, and drops the rest.
 */
export function landmarkX(at: number, offset: number): number {
  const raw = wrapPanorama(at - offset);
  return raw > PANORAMA_WIDTH / 2 ? raw - PANORAMA_WIDTH : raw;
}

/**
 * Evenly spread bearings, jittered - a ring of distant things.
 *
 * One per equal slice rather than `count` free hashes, because free hashes
 * clump: half a lap of empty horizon next to three pines in a huddle reads as a
 * bug in the scroll rather than as scenery.
 */
export function landmarkRing(count: number, seed: number): readonly number[] {
  const slice = PANORAMA_WIDTH / Math.max(count, 1);
  return Array.from({ length: Math.max(count, 0) }, (_unused, index) => {
    let h = Math.imul(index ^ seed, 0x27d4eb2d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    return Math.round(slice * (index + ((h >>> 0) / 0x100000000) * 0.8 + 0.1));
  });
}

/** One turn of ridge, seamless by construction. */
export function panoramaRidge(options: RidgeOptions): readonly number[] {
  return ridgeProfile(PANORAMA_WIDTH, { ...options, period: PANORAMA_WIDTH });
}
