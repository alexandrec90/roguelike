/**
 * The low-poly skin's colours: few, flat, and a little muted.
 *
 * Minimalism is mostly restraint with colour. Each material is one base colour,
 * and the only variation is a small seeded nudge per face (`faceTint`) - enough
 * that a field of triangles reads as facets rather than as a flat sheet, never
 * enough to read as texture. Light and shade come from the face normal at draw
 * time; nothing here is pre-shaded.
 *
 * This is the skin's own palette, not the pixel skin's inks: a skin owns its
 * look. Changing the feel of the whole skin starts here.
 */

import { rgb, type Rgb } from "./mesh";

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
  smoke: rgb("#7a7471"),
  ember: rgb("#ff7d3a"),
  shadow: rgb("#1c2030"),
  slimeGreen: rgb("#6cc98a"),
  slimeFire: rgb("#f08a4b"),
  slimeFrost: rgb("#8fd3f0"),
  slimeArcane: rgb("#a77be0"),
  slimeEye: rgb("#15171e"),
  eyeGlint: rgb("#dfe6e8"),
} as const satisfies Record<string, Rgb>;

export type LowpolyColour = keyof typeof LOWPOLY;

/** How far a face's colour may stray from its material, either way. */
const FACE_SPREAD = 0.045;

/**
 * The material's colour, nudged per face by a seed: brighter or darker by up to
 * `FACE_SPREAD`. Pure - the same face gets the same nudge on every load.
 */
export function faceTint(colour: Rgb, seed: number): Rgb {
  const k = 1 + (hash01(seed) * 2 - 1) * FACE_SPREAD;
  return [colour[0] * k, colour[1] * k, colour[2] * k];
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
