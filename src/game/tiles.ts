/**
 * 16x16 terrain tiles for the overhead-with-vertical-walls projection.
 *
 * The camera looks down, but walls are drawn as a cap plus a face standing
 * straight up the screen — so a wall is two tiles: `WALL_TOP` is what you see
 * from above, `WALL_FACE` is the side that rises toward the viewer.
 *
 * Every tile is authored to repeat: the mortar lines sit on row 0 and column 0
 * only, never on both the first and last row, so a tiled field gets one seam
 * line per boundary instead of a doubled two-pixel one.
 */

import type { Palette, PixelSpriteSource } from "./pixel-art";

export const TILE_SIZE = 16;

const FLOOR_PALETTE: Palette = {
  a: "#2a2732",
  b: "#343040",
  c: "#1d1a24",
  d: "#231f2b",
};

const WALL_TOP_PALETTE: Palette = {
  t: "#4a4453",
  T: "#5b5468",
  e: "#2b2733",
};

const WALL_FACE_PALETTE: Palette = {
  f: "#38323f",
  F: "#484153",
  m: "#241f2c",
};

export const FLOOR_STONE: PixelSpriteSource = {
  palette: FLOOR_PALETTE,
  rows: [
    "cccccccccccccccc",
    "cbbbbbbbcbbbbbbb",
    "caaaaaaacaaaaaaa",
    "caaadaaacaaaaaaa",
    "caaaaaaacaadaaaa",
    "caaaaaaacaaaaaaa",
    "caadaaaacaaaaaaa",
    "caaaaaaacaaaaada",
    "cccccccccccccccc",
    "cbbbbbbbcbbbbbbb",
    "caaaaaaacaaaaaaa",
    "caaaaadacaaaaaaa",
    "caaaaaaacaadaaaa",
    "cadaaaaacaaaaaaa",
    "caaaaaaacaaaaaaa",
    "caaaaaaacaadaaaa",
  ],
};

export const WALL_TOP: PixelSpriteSource = {
  palette: WALL_TOP_PALETTE,
  rows: [
    "eeeeeeeeeeeeeeee",
    "eTTTTTTTeTTTTTTT",
    "etttttttettttttt",
    "etttttttettttttt",
    "etttttttettttttt",
    "etttttttettttttt",
    "etttttttettttttt",
    "etttttttettttttt",
    "eeeeeeeeeeeeeeee",
    "TTTeTTTTTTTeTTTT",
    "tttetttttttetttt",
    "tttetttttttetttt",
    "tttetttttttetttt",
    "tttetttttttetttt",
    "tttetttttttetttt",
    "tttetttttttetttt",
  ],
};

/**
 * Two courses of staggered brick, and nothing that reads as "the bottom".
 *
 * A face tile stacks upward as many times as the wall is tall, so any band
 * inside it — a contact shadow, a highlight — becomes a stripe every sixteen
 * pixels. The shadow where the wall meets the ground is drawn once, by whatever
 * sits at its foot, and is not this tile's business.
 */
export const WALL_FACE: PixelSpriteSource = {
  palette: WALL_FACE_PALETTE,
  rows: [
    "mmmmmmmmmmmmmmmm",
    "mfffffffmfffffff",
    "mfffffffmfffffff",
    "mfffffffmfffffff",
    "mfffffffmfffffff",
    "mFFFFFFFmFFFFFFF",
    "mfffffffmfffffff",
    "mfffffffmfffffff",
    "mmmmmmmmmmmmmmmm",
    "fffmfffffffmffff",
    "fffmfffffffmffff",
    "fffmfffffffmffff",
    "FFFmFFFFFFFmFFFF",
    "fffmfffffffmffff",
    "fffmfffffffmffff",
    "fffmfffffffmffff",
  ],
};

export const ALL_TILES: readonly PixelSpriteSource[] = [FLOOR_STONE, WALL_TOP, WALL_FACE];
