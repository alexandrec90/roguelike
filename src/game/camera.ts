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
 *
 * The field has a far edge, and the world does not stop there. `localFoot` is
 * the affine answer and is right anywhere on the flat field; `localPlacement`
 * is the whole answer, and past the far edge it hands the point to the horizon
 * roll (`horizon.ts`), where it lands a little higher and a little smaller for
 * every row it is further away, until the horizon line.
 */

import { rollPlacement } from "./horizon";
import type { LocalPoint } from "./planet";
import { rowAtFoot, TILE_DEPTH, TILE_WIDTH, type ScreenPoint } from "./projection";

export interface CameraFrame {
  /** First scanline of the flat playfield, from `horizonLayout`. */
  readonly groundTop: number;
  /** Scanlines of ground rolling away above it, from the same layout. */
  readonly rollHeight: number;
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

/** Where a body stands on screen, and how large — in the field or on the roll. */
export interface Placement extends ScreenPoint {
  /** 1 anywhere in the flat field; `rollScale` past its far edge. */
  readonly scale: number;
  /** False once the point is so far over the horizon that nothing standing there could show. */
  readonly visible: boolean;
  /**
   * The first scanline that hides it: the horizon line for a body past it,
   * whose foot has sunk below the line and whose top still shows above it;
   * `Infinity` this side of the horizon.
   */
  readonly clipY: number;
}

/** How far down the line a body's sink may go before nothing on the planet is tall enough to show. */
const DEEPEST_SINK = 900;

/** What the projection does at one depth: where the ground is, and how large things are there. */
export interface DepthProjection {
  /** Screen y of the ground, continuous; past the horizon, the line pushed down by the sink. */
  readonly ground: number;
  /** 1 on the field, `rollScale` past it. */
  readonly scale: number;
  /** Rows past the field's far edge; 0 on the field. */
  readonly rowsBeyond: number;
  /** As `Placement.clipY`. */
  readonly clipY: number;
  /** Pixels of height, at full size, hidden below the horizon line. */
  readonly sink: number;
}

/**
 * The projection at a local depth `localY`, for everything that stands - the
 * one answer the scenery, the landforms and the roll's own ground share.
 *
 * On the field it is the affine grid. Past its far edge the ground climbs the
 * roll and things shrink (`rollPlacement`), and past the horizon line they sink
 * behind the curve, foot first, and are cut off at the line: a mountain a
 * hundred rows away is a peak over the horizon, not nothing, and nothing pops
 * when it comes into view.
 */
export function projectDepth(frame: CameraFrame, localY: number): DepthProjection {
  const affineY = frame.footY - (localY - frame.phaseY) * TILE_DEPTH;
  if (affineY >= frame.groundTop) {
    return { ground: affineY, scale: 1, rowsBeyond: 0, clipY: Number.POSITIVE_INFINITY, sink: 0 };
  }
  const rowsBeyond = (frame.groundTop - affineY) / TILE_DEPTH;
  const roll = rollPlacement(rowsBeyond, frame.rollHeight);
  const line = frame.groundTop - frame.rollHeight * roll.lift;
  return {
    ground: line + roll.sink * roll.scale,
    scale: roll.scale,
    rowsBeyond,
    clipY: roll.beyond ? frame.groundTop - frame.rollHeight : Number.POSITIVE_INFINITY,
    sink: roll.sink,
  };
}

/**
 * Where a local point's feet land, including past the field's far edge.
 *
 * `localFoot` is the flat field's answer and stops being true the moment the
 * affine projection puts a foot above `groundTop`: that scanline is where the
 * ground starts curving away, and a thing standing there is drawn on the roll
 * instead — a fraction of the way up it and a fraction of its size, both by
 * `rollPlacement`. The two answers meet exactly at the seam, so a tree walking
 * onto the field arrives at full size on the top scanline and never pops.
 *
 * `x` converges on the hero's own column as a body recedes, by the same scale
 * that shrinks it. That is perspective's convergence, applied only past the
 * field: inside it the grid is affine and a column is a column.
 */
export function localPlacement(frame: CameraFrame, local: LocalPoint): Placement {
  const depth = projectDepth(frame, local.y);
  if (depth.rowsBeyond === 0) {
    return { ...localFoot(frame, local), scale: 1, visible: true, clipY: depth.clipY };
  }
  return {
    x: Math.round(frame.footX + (local.x - frame.phaseX) * TILE_WIDTH * depth.scale),
    y: Math.round(depth.ground),
    scale: depth.scale,
    visible: depth.sink < DEEPEST_SINK,
    clipY: depth.clipY,
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
 * A layer setting a depth wants `groundRow`, which keeps that true *and* keeps
 * everything on the ground in one order while it scrolls.
 */
export function localRow(frame: CameraFrame, local: LocalPoint): number {
  return rowAtFoot(localFoot(frame, local).y, frame.groundTop);
}

/** The scroll down the screen, in rows: `scrollOffset`'s whole pixels, so it slides what that slides. */
export function scrollRows(frame: CameraFrame): number {
  return Math.round(frame.phaseY * TILE_DEPTH) / TILE_DEPTH;
}

/** The whole row a local point sorts on before the scroll: `localRow` on the zero-phase grid, rounded there. */
export function latticeRow(frame: CameraFrame, local: LocalPoint): number {
  return Math.round(rowAtFoot(Math.round(frame.footY - local.y * TILE_DEPTH), frame.groundTop));
}

/**
 * The row a thing on the ground sorts on: its lattice row, slid by the scroll.
 *
 * Everything on the ground scrolls as one rigid picture, so its order among
 * itself must not change while the picture slides - only its order against
 * the hero, who stays put. Rounding `localRow` after the scroll broke that: a
 * boulder's row and the grass row at its foot rounded at different points in
 * the stride, and the tufts blinked over and under it as the hero walked. So
 * the row is rounded on the zero-phase grid, and the slide is added after,
 * whole and the same for every layer. The grass sorts by the same pair
 * (`vegetation-layer.ts`).
 */
export function groundRow(frame: CameraFrame, local: LocalPoint): number {
  return latticeRow(frame, local) + scrollRows(frame);
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
