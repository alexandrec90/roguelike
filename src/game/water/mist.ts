/**
 * Mist on the horizon when it rains hard: a band of sheer grey that swallows
 * the far edge of the world.
 *
 * Rain seen through a mile of rain is not streaks any more, it is haze — and
 * a haze band at the horizon line is also what makes the near rain read as
 * *near*. It is noise thresholded against the Bayer matrix (so it is pixel art,
 * not a blur) in the sheer `smoke` inks (so the ridge and the far trees still
 * show through it), densest just below the horizon and thinning both ways.
 *
 * A pure function of its arguments; a layer bakes it only when the rain level
 * or the light has moved a visible step.
 */

import type { InkId, PixelCloud } from "../ink";
import { fbm2 } from "../procgen/noise";
import { ditherThreshold } from "../shading";

/** How far the band reaches either side of its centre line at a rain level of 1, in rows. */
export const MIST_REACH = 16;

/** Below this rain level there is no mist at all. */
const MIST_FROM = 0.35;

export function mistCloud(
  width: number,
  horizonY: number,
  groundTop: number,
  rain: number,
  daylight: number,
  seed = 0x3157,
): PixelCloud {
  const cloud: PixelCloud = [];
  const strength = Math.min(Math.max((rain - MIST_FROM) / (1 - MIST_FROM), 0), 1);
  if (strength <= 0) {
    return cloud;
  }
  const centre = Math.round((horizonY + groundTop) / 2) + 2;
  const reach = Math.max(2, Math.round(MIST_REACH * (0.5 + 0.5 * strength)));
  const inks: readonly InkId[] = daylight > 0.45 ? ["smoke-3", "smoke-2"] : ["smoke-2", "smoke-1"];

  for (let y = centre - reach; y <= centre + reach; y += 1) {
    const falloff = 1 - Math.abs(y - centre) / (reach + 1);
    for (let x = 0; x < width; x += 1) {
      const n = fbm2(x / 26, y / 6, seed, { octaves: 2 });
      const density = strength * falloff ** 1.4 * (0.45 + 0.75 * n);
      if (density > ditherThreshold(x, y)) {
        cloud.push({ x, y, ink: density > 0.75 ? (inks[0] as InkId) : (inks[1] as InkId) });
      }
    }
  }
  return cloud;
}
