/**
 * The light and the sky both backends hand their shaders, from the atmosphere.
 */

import type { Atmosphere } from "../../game/atmosphere";
import { mixRgb, rgb, type Rgb } from "./mesh";

/**
 * The atmosphere's light as a direction in the local frame.
 *
 * Its `light` is screen-space - +x right, +y *down* - and stays so: the sun
 * turns with the camera, as in the pixel skin, so the planet never needs
 * re-lighting per heading. Screen-up reads as "from above and a little behind
 * the viewer", so faces turned to the camera catch it; the elevation lifts it.
 */
export function lightDirection(atmosphere: Pick<Atmosphere, "light" | "elevation">): Rgb {
  const x = atmosphere.light.x;
  const y = atmosphere.light.y * 0.45;
  const z = 0.3 + atmosphere.elevation;
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

/**
 * What still water shows with nothing standing over it. The projection is
 * parallel, so every pixel of a mirror looks up the same way: steeply, at the
 * upper sky, a little toward the horizon's colour.
 */
export function stillSky(atmosphere: Pick<Atmosphere, "skyTop" | "skyHorizon">): Rgb {
  return mixRgb(rgb(atmosphere.skyTop), rgb(atmosphere.skyHorizon), 0.35);
}
