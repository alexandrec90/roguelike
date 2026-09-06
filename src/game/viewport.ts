/**
 * How much of the render target the window is actually showing, and how much
 * field is left to walk on inside it.
 *
 * The canvas is cover-scaled (`integer-scale.ts`): the 320x180 target is blown
 * up by the smallest whole factor that covers the window, horizontal overflow
 * is centre-cropped and vertical overflow is clipped off the *near* edge, so
 * the horizon stays pinned to the top of the screen whatever the window does.
 *
 * That contract keeps the sky on screen at the price of the near rows. The
 * *walkable band* is what is left: the strip between the foot of the horizon
 * roll and the last scanline the window still shows.
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
 * What the band is *for* changed when the world became round. It used to fence
 * a map: the near rows were ground the crop had taken away, so the hero had to
 * be counted out of them and clamped back inside. There is no map now and no
 * near edge - the hero is pinned to one pixel and the planet slides under him
 * (`camera.ts`) - so the band's only remaining job is to say which pixel that
 * is. The window still decides how much world you can see; it can no longer
 * decide how much of it exists.
 *
 * Horizontally there is nothing to derive: cover scaling centre-crops, so every
 * column the target has is a column the screen shows.
 *
 * Everything here is pure so the arithmetic is asserted in tests rather than
 * eyeballed against a resized browser window.
 */

import type { ScreenPoint } from "./projection";

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
 * The logical pixel the hero's feet stand on - and, because the camera is bolted
 * to him, the point the whole world is drawn around.
 *
 * On a round planet the window can no longer take ground away from him: there is
 * no edge to be carried off, and walking is the world sliding rather than the
 * hero crossing a map. So this is the whole of the viewport's remaining say over
 * the simulation, and it is a framing decision - put the *silhouette* in the
 * middle of the band, not the origin, or a tall hero sits low in a short window
 * while a short one floats.
 *
 * Horizontal centring is free: cover scaling centre-crops, so the middle of the
 * target is the middle of the screen at every width.
 *
 * When the band is shorter than he is tall there is no centre to find, and the
 * choice is which end to lose. The head stays: a hero cropped at the ankles
 * still reads as a hero, and one cropped at the neck reads as a bug.
 */
export function anchorFoot(band: Band, width: number, heroHeight: number): ScreenPoint {
  const span = band.bottom - band.top;
  const y =
    span >= heroHeight
      ? band.top + Math.round((span + heroHeight) / 2)
      : band.top + Math.round(heroHeight);
  return { x: Math.round(width / 2), y: Math.max(y, band.top + 1) };
}
