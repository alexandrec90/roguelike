/**
 * Where a planet-anchored effect lands on screen.
 *
 * Everything in `fire/` that is *on the planet* — the campfire, a blast, a
 * scorch — is placed from the **zero-phase** grid plus `scrollOffset`, the same
 * two roundings the ground tiles and the water use. Placing it with the phased
 * `localFoot` instead rounds the sum once where the ground rounds its two parts
 * separately, and the effect then shears a pixel against the tile it sits on
 * for half of every step. Pure, so the arithmetic is testable.
 */

import { localFoot, scrollOffset, type CameraFrame } from "../camera";
import type { LocalPoint } from "../planet";
import type { ScreenPoint } from "../projection";

export function groundFoot(frame: CameraFrame, local: LocalPoint): ScreenPoint {
  const flat: CameraFrame = { ...frame, phaseX: 0, phaseY: 0 };
  const foot = localFoot(flat, local);
  const offset = scrollOffset(frame);
  return { x: foot.x + offset.x, y: foot.y + offset.y };
}

/**
 * Whether a foot is on the flat field and near enough the target to draw.
 *
 * Past `groundTop` is the horizon roll, where a body is drawn smaller; these
 * effects are small and short-lived and are simply not drawn there, rather than
 * floating over the curve at full size.
 */
export function onField(frame: CameraFrame, foot: ScreenPoint, width: number, height: number, margin: number): boolean {
  return foot.y >= frame.groundTop && foot.x > -margin && foot.x < width + margin && foot.y < height + margin;
}
