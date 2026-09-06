/**
 * The local frame on screen: where the hero stands, and how far the world has
 * slid under him since his last whole step.
 *
 * The hero does not move. That is the whole trick of a camera that turns with
 * him: he is nailed to one logical pixel - `footX`, `footY` - and the planet
 * slides and swings beneath. Every other layer asks this module the same
 * question, "this thing is `x` tiles right of him and `y` tiles ahead, where do
 * I draw it", and gets one answer, so the ground, the rocks, the trees and the
 * puddles cannot disagree about where the world has got to.
 *
 *      local (0, +2)                      screen
 *            |                    +---------------------+
 *      local (0, +1)              |         .           |  y - 2 * TILE_DEPTH
 *            |                    |         .           |  y - 1 * TILE_DEPTH
 *      local (0,  0) = hero  ==>  |     [hero] o (footX, footY)
 *            |                    |                     |  y + 1 * TILE_DEPTH
 *      local (0, -1)              +---------------------+
 *
 * `phaseX` / `phaseY` are the sub-tile part of a step in progress, in tiles.
 * They are the standard tile-scroll: the *integer* part of the world's motion
 * lives in which planet point each grid cell samples, the *fractional* part
 * lives here as a pixel offset, and when a step completes the sample advances
 * by exactly one cell as the offset resets by exactly one cell. The two cancel,
 * so a walk is smooth even though the grid it is drawn on never moved.
 *
 * The hero himself is the one thing drawn without the phase - he is the anchor,
 * so the phase is precisely the amount the rest of the world is offset *from*
 * him.
 */

import type { LocalPoint } from "./planet";
import { rowAtFoot, TILE_DEPTH, TILE_WIDTH, type ScreenPoint } from "./projection";

export interface CameraFrame {
  /** First scanline of the flat playfield, from `horizonLayout`. */
  readonly groundTop: number;
  /** The logical pixel the hero's feet stand on. Everything is measured from it. */
  readonly footX: number;
  readonly footY: number;
  /** Tiles of a step already walked: +x is rightward, +y is forward. */
  readonly phaseX: number;
  readonly phaseY: number;
}

/** The local tiles the render target can show, with a cell of margin. */
export interface LocalBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Where a local point's feet land on screen, scroll included. */
export function localFoot(frame: CameraFrame, local: LocalPoint): ScreenPoint {
  return {
    x: Math.round(frame.footX + (local.x - frame.phaseX) * TILE_WIDTH),
    y: Math.round(frame.footY - (local.y - frame.phaseY) * TILE_DEPTH),
  };
}

/**
 * The scroll, as a whole-pixel offset.
 *
 * Handed to a layer that has already laid its art out on the zero-phase grid, so
 * a whole field of tiles moves by one container position per frame instead of by
 * four hundred. Rounded here, once, so nothing in the picture can round the same
 * scroll a different way and shear against its neighbour.
 */
export function scrollOffset(frame: CameraFrame): ScreenPoint {
  // Subtracted rather than negated: `Math.round(-0 * 16)` is negative zero, and
  // a coordinate that is not equal to itself is not worth the cleverness.
  return {
    x: 0 - Math.round(frame.phaseX * TILE_WIDTH),
    y: Math.round(frame.phaseY * TILE_DEPTH),
  };
}

/** Top-left of the ground tile a local point stands on - what a blit needs. */
export function localOrigin(frame: CameraFrame, local: LocalPoint): ScreenPoint {
  const foot = localFoot(frame, local);
  return { x: foot.x - TILE_WIDTH / 2, y: foot.y - TILE_DEPTH };
}

/**
 * The fractional screen row a local point sits on.
 *
 * Fractional because the scroll leaves things between rows, and the scene sorts
 * on `row * TILE_WIDTH + rank`: a tree half a row nearer than a rock has to sort
 * in front of it during the half-step where that is true, not snap past it.
 */
export function localRow(frame: CameraFrame, local: LocalPoint): number {
  return rowAtFoot(localFoot(frame, local).y, frame.groundTop);
}

/**
 * Which local tiles the target can show.
 *
 * A cell of margin on every side, because the phase slides the whole grid by up
 * to a tile and the row that scrolls on has to already exist.
 */
export function visibleLocal(frame: CameraFrame, width: number, height: number): LocalBounds {
  return {
    minX: Math.floor(-frame.footX / TILE_WIDTH) - 1,
    maxX: Math.ceil((width - frame.footX) / TILE_WIDTH) + 1,
    minY: Math.floor((frame.footY - height) / TILE_DEPTH) - 1,
    maxY: Math.ceil((frame.footY - frame.groundTop) / TILE_DEPTH) + 1,
  };
}

/**
 * Radius of a disc around the hero that contains every visible tile.
 *
 * Point features are gathered inside a *disc* rather than inside these bounds
 * because the bounds are in the local frame and the frame turns: a tree must not
 * blink into being because the hero rotated the box onto it.
 */
export function localReach(bounds: LocalBounds): number {
  const across = Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX)) + 1;
  const deep = Math.max(Math.abs(bounds.minY), Math.abs(bounds.maxY)) + 1;
  return Math.ceil(Math.hypot(across, deep));
}
