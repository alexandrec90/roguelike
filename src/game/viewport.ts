/**
 * How much of the render target the window is actually showing, and where the
 * hero stands inside it.
 *
 * The canvas is cover-scaled (`integer-scale.ts`): the 320x180 target is blown
 * up by the smallest whole factor that covers the window, horizontal overflow
 * is centre-cropped and vertical overflow is clipped off the *near* edge, so
 * the horizon stays pinned to the top of the screen whatever the window does.
 *
 * That contract keeps the sky on screen but says nothing about the hero, and a
 * fixed world cell is the wrong place for him: shorten the window and the near
 * rows he was standing on are the first thing clipped away. So his position is
 * derived rather than authored — he sits at the middle of the *walkable band*,
 * the strip between the foot of the horizon roll and the last scanline the
 * window still shows. Shorten or widen the window and he stays there.
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
 * Horizontally there is nothing to derive: cover scaling centre-crops, so the
 * middle of the render target is the middle of the screen at every window
 * width, and a hero centred on the target is centred on the screen.
 *
 * Everything here is pure so the arithmetic is asserted in tests rather than
 * eyeballed against a resized browser window.
 */

import type { CloudBounds } from "./ink";

/** A vertical strip of the screen, in logical scanlines. `bottom` is exclusive. */
export interface Band {
  readonly top: number;
  readonly bottom: number;
}

export interface Anchor {
  readonly x: number;
  readonly y: number;
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
 * Where to drop a pixel cloud so it sits in the middle of the band.
 *
 * The returned point is the cloud's *origin* — its foot — because that is what
 * `drawCloud` takes and what the water layer reflects. Bounds are relative to
 * that origin, so a cloud drawn from `y` occupies `y + top .. y + bottom`, and
 * centring means putting the middle of that span on the middle of the band.
 *
 * A cloud taller than the band is pinned by its head instead of centred: it
 * cannot fit either way, and losing the feet reads as a hero standing behind
 * the near edge, while losing the head reads as a decapitation.
 */
export function centerFoot(bounds: CloudBounds | null, band: Band, centerX: number): Anchor {
  if (bounds === null) {
    return { x: Math.round(centerX), y: Math.round((band.top + band.bottom) / 2) };
  }

  const x = Math.round(centerX - (bounds.left + bounds.right) / 2);
  const head = band.top - bounds.top;
  const feet = band.bottom - bounds.bottom;
  if (bounds.bottom - bounds.top + 1 >= band.bottom - band.top) {
    return { x, y: head };
  }

  const centred = Math.round((band.top + band.bottom) / 2 - (bounds.top + bounds.bottom) / 2);
  return { x, y: Math.min(Math.max(centred, head), feet) };
}
