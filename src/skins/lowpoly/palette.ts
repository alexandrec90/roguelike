/**
 * The low-poly skin's colours: few, flat, and a little muted.
 *
 * Minimalism is mostly restraint with colour. Each material is one base colour,
 * and under the flat look the only variation is a small seeded nudge per face
 * (`faceTint`) - enough that a field of triangles reads as facets rather than as
 * a flat sheet, never enough to read as texture. The painted look (`look.ts`)
 * lets go of that restraint on purpose: bolder nudges that drift in hue, and
 * `PAINT`'s warm, cool and umber for the shaders' stepped light. Either way,
 * light and shade come from the face normal at draw time; nothing here is
 * pre-shaded.
 *
 * This is the skin's own palette, not the pixel skin's inks: a skin owns its
 * look. Changing the feel of the whole skin starts here.
 */

import { FLAT_LOOK, type Look } from "./look";
import { mixRgb, rgb, type Rgb } from "./mesh";

export const LOWPOLY = {
  grass: rgb("#7fae5a"),
  grassDry: rgb("#a7b865"),
  path: rgb("#c9a978"),
  shore: rgb("#d8c99a"),
  bark: rgb("#7a5a44"),
  leaf: rgb("#5f9b4c"),
  leafLight: rgb("#86b55a"),
  pine: rgb("#3f7a5a"),
  autumn: rgb("#d08a3e"),
  ash: rgb("#9cbf6a"),
  bush: rgb("#6aa452"),
  rock: rgb("#9a9a96"),
  rockDark: rgb("#7b7c7d"),
  snow: rgb("#f2f4f2"),
  cliff: rgb("#c98b5e"),
  mesaTop: rgb("#9cb565"),
  wall: rgb("#bdb4a4"),
  roof: rgb("#b9584a"),
  mushroomCap: rgb("#d9574a"),
  mushroomStem: rgb("#efe6d2"),
  bone: rgb("#e6dcc0"),
  socket: rgb("#2a2224"),
  trail: rgb("#f4faff"),
  fire: rgb("#ffb347"),
  fireCore: rgb("#fff1b0"),
  frost: rgb("#bfe9ff"),
  shadow: rgb("#1c2030"),
} as const satisfies Record<string, Rgb>;

export type LowpolyColour = keyof typeof LOWPOLY;

/**
 * The painted look's colours (`look.ts`). `warm`, `cool` and `deep` are the
 * colours of light a lit face, a shaded face and an underside lean toward - the
 * shaders bake them in, and each face picks one of the three by its own seed,
 * so the sun is yellow on one plane and orange on the next, as a painter lays
 * it. `drift` is the hues a face may wander toward whatever its light, so a
 * crown is yellow, sage and slate rather than one green; `accent` is the rare
 * complementary dab.
 */
export const PAINT = {
  warm: [rgb("#f2d47c"), rgb("#ec9a5a"), rgb("#efbe9a")],
  cool: [rgb("#6c84a6"), rgb("#4f74b8"), rgb("#5e8f92")],
  deep: [rgb("#4a3a2f"), rgb("#2e3954"), rgb("#4b3346")],
  accent: rgb("#e2683a"),
  drift: [rgb("#a3b58a"), rgb("#7f96b2"), rgb("#d8c077"), rgb("#a9c3d8"), rgb("#e9e0c6"), rgb("#c9825a")],
} as const;

/**
 * Where the painted light steps, as both shaders read it. A body steps on how
 * squarely it faces the sun (0..1, times the sun's strength); the ground on how
 * much more or less squarely than level ground does. `edge` is half the width
 * of a step's blend - narrow, so a face turning past a line as the world turns
 * crosses in a frame or two rather than popping. `bodyNudge` and `groundNudge`
 * are how far a face's own seeded nudge moves its lines: much less on the
 * ground, whose steps are narrow, or every tile picks its own step at random.
 */
export const PAINT_STEPS = {
  bodyShade: 0.3,
  bodyLit: 0.62,
  groundShade: -0.05,
  groundLit: 0.05,
  edge: 0.015,
  bodyNudge: 0.08,
  groundNudge: 0.012,
  /** How far each step's colour of light is mixed in: lit, shade, underside. */
  warmMix: 0.55,
  coolMix: 0.6,
  deepMix: 0.7,
} as const;

/**
 * The material's colour, nudged per face by a seed: brighter or darker by up to
 * the look's `faceSpread`, and under the painted look leaned toward one of the
 * drift hues - or, for a face that `accent`s and draws the short straw, the
 * accent instead. Pure - the same face gets the same nudge on every load.
 */
export function faceTint(colour: Rgb, seed: number, look: Look = FLAT_LOOK, accent = false): Rgb {
  if (accent && hash01(seed + 0x51) < look.accent) {
    return PAINT.accent;
  }
  const k = 1 + (hash01(seed) * 2 - 1) * look.faceSpread;
  const hue =
    look.hueDrift > 0 ? mixRgb(colour, PAINT.drift[Math.floor(hash01(seed + 0x2b) * PAINT.drift.length)]!, hash01(seed + 0x3d) * look.hueDrift) : colour;
  return [hue[0] * k, hue[1] * k, hue[2] * k];
}

/** A seeded unit float from an integer. */
export function hash01(seed: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/** A seed from a few integers, for `faceTint` and jitter. */
export function seedOf(...parts: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    h = Math.imul(h ^ (Math.floor(part) | 0), 0x01000193);
  }
  return h >>> 0;
}
