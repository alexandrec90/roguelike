/**
 * The camera: overhead, pitched back so walls stand up the screen.
 *
 * The world is a square grid. The camera looks down at it but is tilted back
 * from vertical, so a world square that is `TILE_WIDTH` on a side lands on the
 * screen as a `TILE_WIDTH x TILE_DEPTH` rectangle, and anything with height
 * rises straight up the screen instead of leaning. There is no yaw: rows and
 * columns stay axis-aligned, which is the standard roguelike read — a diamond
 * grid would need the camera rotated 45 degrees as well, and would put every
 * tile on a half-pixel diagonal.
 *
 * The projection is **affine, not perspective**. Every ground row is exactly
 * `TILE_DEPTH` pixels tall no matter how far away it is, so the playfield is
 * perfectly flat and a tile drawn at the top of it is pixel-identical to the
 * same tile at the bottom. The one place the world stops being flat is the
 * band at the very top of the screen, where it rolls over the horizon; that
 * lives in `horizon.ts` and is deliberately not this module's business.
 *
 * Because the foreshortening is fixed, ground art is **authored already
 * projected** — a floor tile is drawn 16x12, not drawn 16x16 and squashed. That
 * keeps every sprite at 1:1 nearest-neighbour with no runtime resampling, which
 * is the visual contract in CLAUDE.md.
 */

/** A world square is this wide, and this deep, in world units. */
export const TILE_WIDTH = 16;

/** ...and this tall on screen once the camera's pitch is applied. */
export const TILE_DEPTH = 12;

/** One unit of world height, in screen pixels. Walls rise; they do not lean. */
export const WALL_RISE = 16;

/** Screen pixels per world unit of depth. 1 would be a pure top-down camera. */
export const DEPTH_RATIO = TILE_DEPTH / TILE_WIDTH;

export interface WorldPoint {
  /** World units to the right. */
  readonly x: number;
  /** World units away from the camera; larger is further up the screen. */
  readonly y: number;
  /** World units above the ground plane. Optional, defaults to 0. */
  readonly z?: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface Camera {
  /** World point that sits at the near-left corner of the playfield. */
  readonly x: number;
  readonly y: number;
}

export const ORIGIN_CAMERA: Camera = { x: 0, y: 0 };

/**
 * World point to logical screen pixel, snapped to whole pixels.
 *
 * `groundTop` is the screen y of world row 0 — the first scanline below the
 * horizon band — so the caller decides how much of the screen the flat
 * playfield gets without this module knowing about the split.
 */
export function project(
  point: WorldPoint,
  groundTop: number,
  camera: Camera = ORIGIN_CAMERA,
): ScreenPoint {
  return {
    x: Math.round(point.x - camera.x),
    y: Math.round(groundTop + (point.y - camera.y) * DEPTH_RATIO - (point.z ?? 0)),
  };
}

/** Screen top-left of ground cell `(column, row)`; row 0 is the furthest. */
export function cellOrigin(column: number, row: number, groundTop: number): ScreenPoint {
  return { x: column * TILE_WIDTH, y: groundTop + row * TILE_DEPTH };
}

/**
 * Screen top of a wall block's cap, given the top of the cell it stands on.
 *
 * The cap is the same rectangle as the ground cell, lifted by one wall unit —
 * which is what makes the block read as standing rather than painted on.
 */
export function wallCapY(cellTop: number, height = 1): number {
  return cellTop - WALL_RISE * height;
}

/**
 * Screen top of a wall block's front face.
 *
 * The face runs from the cap's near edge down to the cell's near edge, so it is
 * exactly `WALL_RISE` pixels tall for a one-unit block regardless of the pitch.
 */
export function wallFaceY(cellTop: number, height = 1): number {
  return cellTop + TILE_DEPTH - WALL_RISE * height;
}

/** How many whole columns cover `width` logical pixels. */
export function columnsAcross(width: number): number {
  return Math.ceil(width / TILE_WIDTH);
}

/** How many ground rows are needed to cover `groundHeight` logical pixels. */
export function rowsDown(groundHeight: number): number {
  return Math.max(0, Math.ceil(groundHeight / TILE_DEPTH));
}

/**
 * Painter's-algorithm key: far rows first, and within a row the taller thing
 * last so a hero standing in front of a wall is not swallowed by it.
 */
export function depthOf(point: WorldPoint): number {
  return point.y * TILE_WIDTH + (point.z ?? 0);
}
