/**
 * Where a 3D point lands on screen: the pixel skin's projection, given depth.
 *
 * This skin draws real geometry, but it does not use a perspective camera, and
 * that is the point of it. The local view is the game's identity, so it is the
 * pixel skin's exactly: an oblique projection in which a tile across is
 * `TILE_WIDTH` logical pixels, a row ahead is `TILE_DEPTH`, and a tile of height
 * is `WALL_RISE` - rows and columns axis-aligned, nothing converging on the
 * flat field. Past the field's far edge every point goes over the treadmill lip
 * by `horizon.ts`'s one curve (`rollPlacement`): up the roll, smaller, and past
 * the horizon line sunk foot first behind it.
 *
 * So this file and `camera.ts`' `localPlacement` must agree, and a test holds
 * them to it. The vertex shader (`shaders.ts`) is this file again in GLSL,
 * line for line; change one, change both.
 *
 * What depth adds is a z-buffer key. Along any one screen ray of this projection
 * the point further *ahead* is the one further from the eye - a ray runs forward
 * and down - so `ahead` is a correct depth for everything on the field, and the
 * lip keeps it monotone. Nearer rows hide farther ones, which is exactly the
 * painter's rule the pixel skin sorts by.
 */

import { HORIZON_SCALE, horizonLayout, ROLL_ROWS, rollKnee, HORIZON_SINK_RATE, type HorizonLayout } from "../../game/horizon";
import { TILE_DEPTH, TILE_WIDTH, WALL_RISE } from "../../game/projection";
import { anchorFoot, walkableBand } from "../../game/viewport";

/** The logical render target: always this many scanlines tall, as wide as the window's shape allows. */
export const LOGICAL_HEIGHT = 180;

/**
 * The unit direction from the field toward the eye, local frame (x right, y
 * ahead, z up). Every point on a screen ray shares `y·TILE_DEPTH + z·WALL_RISE`,
 * so the ray runs (0, WALL_RISE, −TILE_DEPTH) away from the viewer - one
 * direction for the whole screen, because the projection is parallel. What a
 * face turned this way shows; the shaders' gloss reads it too.
 */
export const TOWARD_VIEWER: readonly [number, number, number] = [
  0,
  -WALL_RISE / Math.hypot(WALL_RISE, TILE_DEPTH),
  TILE_DEPTH / Math.hypot(WALL_RISE, TILE_DEPTH),
];

/** Depths the z-buffer spans, in rows ahead of the hero. */
export const DEPTH_NEAR = -48;
export const DEPTH_FAR = 272;

export interface LowpolyView {
  /** Logical pixels across: `LOGICAL_HEIGHT` times the window's aspect. */
  readonly width: number;
  readonly height: number;
  readonly layout: HorizonLayout;
  /** The logical pixel the hero's feet are nailed to. */
  readonly footX: number;
  readonly footY: number;
  /** `rollKnee` for this layout, and `atan(ROLL_ROWS / knee)` - what the shader is handed. */
  readonly knee: number;
  readonly atanRows: number;
}

/** The view for a window of this shape. */
export function lowpolyView(aspect: number, skyFraction: number, heroHeightPx: number): LowpolyView {
  const height = LOGICAL_HEIGHT;
  const width = Math.max(1, Math.round(height * (Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9)));
  const layout = horizonLayout(height, skyFraction);
  const foot = anchorFoot(walkableBand(layout.groundTop, height), width, heroHeightPx);
  const knee = rollKnee(layout.rollHeight);
  return { width, height, layout, footX: foot.x, footY: foot.y, knee, atanRows: knee > 0 ? Math.atan(ROLL_ROWS / knee) : 1 };
}

/**
 * Most pixels the drawing buffer may have. The frame's cost is mostly per
 * pixel, so a large or high-DPI window would otherwise multiply it: a 4K screen
 * at 2× device pixels is nine times the measured 1280×720 frame. Past the
 * budget the buffer is drawn smaller and the browser scales it up smoothly,
 * which faceted geometry survives far better than a dropped frame.
 */
export const MAX_DRAWN_PIXELS = 1_300_000;

/** The drawing buffer for a window of `width` × `height` CSS pixels at `pixelRatio`, within the budget. */
export function backingSize(width: number, height: number, pixelRatio: number): { width: number; height: number } {
  const wanted = Math.max(width, 1) * Math.max(height, 1) * pixelRatio * pixelRatio;
  const ratio = pixelRatio * Math.min(1, Math.sqrt(MAX_DRAWN_PIXELS / wanted));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/** Rows of flat field the view shows behind the hero's foot and ahead of it, to the lip. */
export function fieldRows(view: LowpolyView): { behind: number; ahead: number } {
  return {
    behind: (view.height - view.footY) / TILE_DEPTH,
    ahead: (view.footY - view.layout.groundTop) / TILE_DEPTH,
  };
}

/** A point on screen, in logical pixels, with its depth key. */
export interface Placed {
  readonly x: number;
  readonly y: number;
  /** Rows ahead, the z-buffer key: smaller is nearer. */
  readonly depth: number;
  /** Rows past the field's far edge: 0 on the field. */
  readonly rowsBeyond: number;
  /** 1 on the field, smaller on the lip and past it. */
  readonly scale: number;
}

/**
 * Place a vertex: `foot` is its body's foot in local tiles (x right, y ahead),
 * `offset` the vertex from that foot in local tiles (x right, y ahead, z up).
 *
 * A body is placed and shrunk about its foot, as a sprite is in the pixel skin;
 * a vertex of the ground or a landform is its own foot, with only height on top.
 */
export function placeVertex(view: LowpolyView, foot: { x: number; y: number }, offset: { x: number; y: number; z: number }): Placed {
  const { groundTop, rollHeight } = view.layout;
  const affineY = view.footY - foot.y * TILE_DEPTH;
  let ground = affineY;
  let scale = 1;
  let rowsBeyond = 0;
  if (affineY < groundTop) {
    rowsBeyond = (groundTop - affineY) / TILE_DEPTH;
    const lift = Math.min(view.knee > 0 ? Math.atan(rowsBeyond / view.knee) / view.atanRows : 1, 1);
    scale = shrinkAt(view, rowsBeyond);
    const sink = rowsBeyond > ROLL_ROWS ? HORIZON_SINK_RATE * (rowsBeyond - ROLL_ROWS) ** 2 : 0;
    ground = groundTop - rollHeight * lift + sink * scale;
  }
  return {
    x: view.footX + (foot.x + offset.x) * TILE_WIDTH * scale,
    y: ground - (offset.y * TILE_DEPTH + offset.z * WALL_RISE) * scale,
    depth: foot.y + offset.y * scale,
    rowsBeyond,
    scale,
  };
}

/** `rollScale`, written the way the shader writes it: from the knee the view already holds. */
function shrinkAt(view: LowpolyView, rowsBeyond: number): number {
  if (rowsBeyond > ROLL_ROWS) {
    return (HORIZON_SCALE * ROLL_ROWS) / rowsBeyond;
  }
  if (view.knee <= 0) {
    return HORIZON_SCALE;
  }
  const squash = (row: number): number => 1 / (1 + (row / view.knee) ** 2);
  const far = squash(ROLL_ROWS);
  const share = Math.max(0, (squash(rowsBeyond) - far) / (1 - far));
  return HORIZON_SCALE + (1 - HORIZON_SCALE) * Math.sqrt(share);
}
