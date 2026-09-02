/**
 * The one bridge from a pixel cloud to the screen.
 *
 * Everything renderable in this game flattens to a `PixelCloud`, so everything
 * that draws goes through here — the hero, the water, the rings on it. It lives
 * in its own module because it is the only piece the scene and the water layer
 * both need, and a shared helper reaching back into the scene that happens to
 * host it is how two modules quietly become one.
 */

import { hexToInt } from "./color";
import { INK_ALPHA, INK_COLORS, type InkId, type PixelCloud } from "./ink";

/**
 * Group by ink so a 100-pixel model costs a handful of fill-style switches.
 *
 * `alpha` is the *caller's* opinion — how hard this particular draw is lit —
 * and it multiplies the ink's own `INK_ALPHA`, which is a property of the
 * colour and travels with it everywhere. Phaser takes the two as a numeric fill
 * alpha rather than as an eight-digit hex, which `hexToInt` could not parse
 * anyway.
 */
export function drawCloud(
  gfx: Phaser.GameObjects.Graphics,
  cloud: PixelCloud,
  originX: number,
  originY: number,
  alpha = 1,
): void {
  const byInk = new Map<InkId, { x: number; y: number }[]>();
  for (const pixel of cloud) {
    const bucket = byInk.get(pixel.ink);
    if (bucket === undefined) {
      byInk.set(pixel.ink, [{ x: pixel.x, y: pixel.y }]);
    } else {
      bucket.push({ x: pixel.x, y: pixel.y });
    }
  }
  for (const [ink, pixels] of byInk) {
    gfx.fillStyle(hexToInt(INK_COLORS[ink]), INK_ALPHA[ink] * alpha);
    for (const pixel of pixels) {
      gfx.fillRect(originX + pixel.x, originY + pixel.y, 1, 1);
    }
  }
}
