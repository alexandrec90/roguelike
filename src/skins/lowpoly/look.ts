/**
 * How this skin paints what it draws: `?look=`, chosen once per load.
 *
 * | Look | Light | Faces | Ground |
 * | --- | --- | --- | --- |
 * | `flat` (default) | smooth, one colour scaled by the sun | a whisper of tint each | level, a hair of relief |
 * | `painted` | a few flat steps, each face taking its own colour of light: lit yellow, orange or peach; shade slate, cobalt or teal; undersides umber, navy or plum | bolder tints drifting in hue, a rare accent, lopsided crowns, some faces split round a bump or a dent | rolling hills of large planes and tiny facets, flattened wherever water can stand |
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
  /** The chance a 2×2 square of ground tiles is drawn as one plane (`ground-facets.ts`). */
  readonly merge: number;
  /** The chance a 4×4 square is, tried first. */
  readonly mergeLarge: number;
  /** The chance a ground tile, or a blob's or frond's face, is split into small faces round a new point. */
  readonly split: number;
  /** How far that new point is pushed out (a bump) or in (a dent), as a share of the face's size. */
  readonly bump: number;
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
  merge: 0,
  mergeLarge: 0,
  split: 0,
  bump: 0,
};

export const PAINTED_LOOK: Look = {
  name: "painted",
  stepped: 1,
  faceSpread: 0.1,
  hueDrift: 0.45,
  accent: 0.025,
  jitter: 1.8,
  stretch: 0.22,
  peak: 0.45,
  hills: 0.9,
  // Small: a wobble steeper than the hills tips each tile across a light step on its own, and the field turns to crumpled paper.
  relief: 0.02,
  merge: 0.35,
  mergeLarge: 0.3,
  split: 0.3,
  bump: 0.22,
};

/** `?look=` - `painted`, or anything else for the flat look. */
export function parseLook(raw: string | null): Look {
  return raw?.trim().toLowerCase() === "painted" ? PAINTED_LOOK : FLAT_LOOK;
}
