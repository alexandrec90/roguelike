/**
 * The tail of the hero's scarf: a short Verlet chain pinned to the back of his
 * neck and dragged by how he moves.
 *
 * Secondary motion, the cheapest kind of life: nothing keys it. Walking leans
 * it away from the heading, stopping lets it swing back through, the wind
 * worries at its tip, and his own bob tugs its root. It is drawn as capsules
 * in the volumetric body (`ScreenPrim`s), so it is lit, outlined and depth-
 * sorted with everything else — behind him when he faces the camera, down his
 * back when he walks away.
 */

import { createChain, stepChain, type Chain } from "../procgen/verlet";
import type { ScreenPrim } from "./volume-raster";

export interface Scarf {
  readonly chain: Chain;
}

/** Segments and their length: a tail about as long as his torso. */
export const SCARF_SEGMENTS = 4;
export const SCARF_LINK = 1.8;

export function createScarf(seed: number): Scarf {
  return {
    chain: createChain({
      segments: SCARF_SEGMENTS,
      restLength: SCARF_LINK,
      gravity: 0.00016,
      damping: 0.9,
      iterations: 4,
      seed,
    }),
  };
}

/**
 * Pin the root to the neck and advance the tail under a drive, px/ms².
 *
 * The root is moved rather than simulated: it *is* the neck, and the chain's
 * relaxation drags the rest after it, which is where the tug of each step
 * comes from.
 */
export function stepScarf(
  scarf: Scarf,
  anchor: { readonly x: number; readonly y: number },
  deltaMs: number,
  drive: { readonly x: number; readonly y: number },
): void {
  const root = scarf.chain.points[0];
  if (root !== undefined) {
    root.x = anchor.x;
    root.y = anchor.y;
    root.previousX = anchor.x;
    root.previousY = anchor.y;
  }
  stepChain(scarf.chain, deltaMs, (_index, depth) => ({ x: drive.x * (0.5 + depth), y: drive.y * (0.5 + depth) }));
}

/** Jump the whole tail to hang from `anchor`, for a first frame or a teleport. */
export function settleScarf(scarf: Scarf, anchor: { readonly x: number; readonly y: number }): void {
  scarf.chain.points.forEach((point, index) => {
    point.x = anchor.x;
    point.y = anchor.y + index * SCARF_LINK;
    point.previousX = point.x;
    point.previousY = point.y;
  });
}

/** The tail as capsules at one depth, tapering to the tip. */
export function scarfPrims(scarf: Scarf, depth: number, group: number): ScreenPrim[] {
  const prims: ScreenPrim[] = [];
  const points = scarf.chain.points;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (a === undefined || b === undefined) {
      continue;
    }
    const taper = index / Math.max(points.length - 1, 1);
    prims.push({
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      ra: 1.05 - taper * 0.3,
      rb: 0.95 - taper * 0.3,
      da: depth,
      db: depth,
      material: "crimson",
      shade: -0.04 - taper * 0.08,
      group,
    });
  }
  return prims;
}
