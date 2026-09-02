/**
 * How much of the render target the window is actually showing, and how much
 * field is left to walk on inside it.
 *
 * The canvas is cover-scaled (`integer-scale.ts`): the 320x180 target is blown
 * up by the smallest whole factor that covers the window, horizontal overflow
 * is centre-cropped and vertical overflow is clipped off the *near* edge, so
 * the horizon stays pinned to the top of the screen whatever the window does.
 *
 * That contract keeps the sky on screen at the price of the near rows, and the
 * player is the one thing on the field that can walk into them. So the window,
 * not the map, has the last word on how big the field is: the *walkable band*
 * is the strip between the foot of the horizon roll and the last scanline the
 * window still shows, and only the rows whose feet land inside it exist as far
 * as the simulation is concerned.
 *
 *     y = 0            +-----------------+  sky, always visible
 *     y = groundTop    +=================+  \
 *                      |                 |   |  walkable band: what is left of
 *                      |      hero       |   |  the playfield after the window
 *                      |                 |   |  has clipped the near rows
 *     y = visible      +-----------------+  /
 *                      :  clipped away   :
 *     y = 180          + - - - - - - - - +
 *
 * Horizontally there is nothing to derive: cover scaling centre-crops, so every
 * column the target has is a column the screen shows.
 *
 * Everything here is pure so the arithmetic is asserted in tests rather than
 * eyeballed against a resized browser window.
 */

import { rowAtFoot } from "./field";

/** A vertical strip of the screen, in logical scanlines. `bottom` is exclusive. */
export interface Band {
  readonly top: number;
  readonly bottom: number;
}

/**
 * Logical scanlines of the render target the window still shows.
 *
 * Cover scaling never leaves a gap, so this is at most the whole target; a
 * window shorter than `baseHeight * factor` sees the difference clipped off
 * the near edge.
 */
export function visibleHeight(hostHeight: number, factor: number, baseHeight: number): number {
  if (factor <= 0) {
    throw new Error("Scale factor must be positive");
  }
  if (!Number.isFinite(hostHeight) || hostHeight <= 0) {
    return baseHeight;
  }
  return Math.min(Math.floor(hostHeight / factor), baseHeight);
}

/**
 * The strip an actor may stand in: below the horizon band, above the clip.
 *
 * A window too short to show even one scanline of playfield would otherwise
 * produce an inverted band, so the floor is one scanline. The hero is then off
 * the bottom of the screen, which is honest, rather than up in the sky, which
 * would read as a drawing bug.
 */
export function walkableBand(groundTop: number, visible: number): Band {
  return { top: groundTop, bottom: Math.max(visible, groundTop + 1) };
}

/**
 * How many field rows the band has room for.
 *
 * A row counts only when its *foot* — the scanline an actor standing on it
 * touches, and the one `cellFoot` returns — is still inside the band. Half a
 * row of ground with nothing able to stand on it is scenery, not playfield:
 * fencing the player at the last whole row is what stops him walking off the
 * near edge of a short window into ground the crop has already taken away.
 *
 * The floor is one row. A window too short for even that leaves the hero
 * hanging over the near edge, which is honest about the window, rather than
 * leaving him nowhere to be at all.
 */
export function visibleRows(band: Band): number {
  return Math.max(Math.floor(rowAtFoot(band.bottom, band.top)) + 1, 1);
}
