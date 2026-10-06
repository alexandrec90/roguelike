/**
 * How this skin paints what it draws: `?look=`, chosen once per load.
 *
 * | Look | Light | Faces | Ground |
 * | --- | --- | --- | --- |
 * | `flat` (default) | smooth, one colour scaled by the sun | a whisper of tint each | level, a hair of relief |
 * | `painted` | a few flat steps; the lit step leans warm, shade cool, an underside umber | bolder tints drifting in hue, a rare accent, lopsided crowns | rolling hills, flattened wherever water can stand |
 *
 * The painted look is the flat-colour landscape painting rather than the
 * brushwork: light and shade as a handful of hard-edged planes of different
 * hue. A look decides only how things look - every placement is still the
 * shared simulation's - and a body's foot follows the ground it draws
 * (`standingHeight`), so the hills never bury anyone.
 */

export type LookName = "flat" | "painted";

export interface Look {
  readonly name: LookName;
  /** 1 lights in hue-shifted steps (the shaders' `shading.w`), 0 smoothly. */
  readonly stepped: number;
  /** How far a face's brightness may stray from its material, either way. */
  readonly faceSpread: number;
  /** How far, 0..1, a face's hue may lean toward one of the drift colours (`PAINT.drift`). */
  readonly hueDrift: number;
  /** The chance a crown or ground face takes the accent colour instead. */
  readonly accent: number;
  /** Multiplies how far a blob's corners are pushed in or out. */
  readonly jitter: number;
  /** How unevenly a blob is stretched and leaned, as a share of its radius. */
  readonly stretch: number;
  /** How far a crown's upper corners are drawn up into a point, as a share of its height. */
  readonly peak: number;
  /** The ground's hills at their tallest, tiles; 0 keeps the field level. */
  readonly hills: number;
  /** How far each ground vertex wanders up or down, tiles. */
  readonly relief: number;
}

export const FLAT_LOOK: Look = {
  name: "flat",
  stepped: 0,
  faceSpread: 0.045,
  hueDrift: 0,
  accent: 0,
  jitter: 1,
  stretch: 0,
  peak: 0,
  hills: 0,
  relief: 0.035,
};

export const PAINTED_LOOK: Look = {
  name: "painted",
  stepped: 1,
  faceSpread: 0.1,
  hueDrift: 0.32,
  accent: 0.025,
  jitter: 1.8,
  stretch: 0.22,
  peak: 0.45,
  hills: 0.9,
  // Small: a wobble steeper than the hills tips each tile across a light step on its own, and the field turns to crumpled paper.
  relief: 0.02,
};

/** `?look=` - `painted`, or anything else for the flat look. */
export function parseLook(raw: string | null): Look {
  return raw?.trim().toLowerCase() === "painted" ? PAINTED_LOOK : FLAT_LOOK;
}
