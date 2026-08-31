/**
 * Outdoor terrain, authored in the camera's projection.
 *
 * A world square is 16x16, but the camera is pitched back (see `projection.ts`)
 * so it lands on the screen as 16x12. The tiles here are drawn **at that size**
 * rather than drawn square and squashed at runtime: a 16x16 source scaled to
 * 0.75 would resample every row, which is exactly the smearing the visual
 * contract exists to prevent. Ground and wall caps are therefore 16 wide by
 * `TILE_DEPTH` tall; a wall face is 16 by `WALL_RISE`, because it stands up the
 * screen and is not foreshortened at all.
 *
 * Every tile shares one palette. That is not tidiness — `composeTiles` builds
 * the whole playfield into a single texture by splicing rows of tokens
 * together, and it can only do that when a token means the same colour in every
 * tile it splices. Tokens are therefore unique per material, so a palette swap
 * aimed at grass cannot silently repaint the path.
 *
 * Seams sit on row 0 and column 0 only, never on both the first and last row,
 * so a tiled field gets one line per boundary instead of a doubled two-pixel
 * one.
 */

import type { Palette, PixelSpriteSource } from "./pixel-art";
import { TILE_DEPTH, TILE_WIDTH, WALL_RISE } from "./projection";

export { TILE_DEPTH, TILE_WIDTH, WALL_RISE };

export const TERRAIN_PALETTE: Palette = {
  // Grass.
  g: "#2f4a33",
  G: "#3d6140",
  h: "#54804d",
  s: "#25392a",
  // Trodden dirt.
  d: "#6b563e",
  D: "#7e6848",
  e: "#4e3f2d",
  p: "#8d7a5c",
  // Rock, seen from above.
  r: "#5a5b52",
  R: "#6c6d61",
  k: "#3a3b36",
  // Rock, seen from the front.
  f: "#45463f",
  F: "#54554c",
  m: "#2c2d29",
};

/**
 * Low-contrast noise, deliberately.
 *
 * A 16x12 cell repeats twenty times across the screen; anything that reads as a
 * shape at 1x reads as wallpaper at twenty, so the blades are one shade apart
 * and the dark clumps are single pixels.
 */
export const GRASS: PixelSpriteSource = {
  palette: TERRAIN_PALETTE,
  rows: [
    "GGgGGGGGhGGGGGGG",
    "GGGGGhGGGGGGgGGG",
    "sGGGGGGGGGGhGGGG",
    "GGGGgGGGGGGGGGGh",
    "GhGGGGGGgGGGGGGG",
    "GGGGGGhGGGGGGGsG",
    "GGgGGGGGGGhGGGGG",
    "GGGGGGGGgGGGGGGG",
    "hGGGGgGGGGGGGhGG",
    "GGGGGGGGGhGGGGGG",
    "GGsGGGGGGGGGgGGG",
    "GGGGhGGGgGGGGGGG",
  ],
};

export const DIRT_PATH: PixelSpriteSource = {
  palette: TERRAIN_PALETTE,
  rows: [
    "dDdddddpddddddDd",
    "ddddDdddddpddddd",
    "dedddddddDdddddd",
    "ddddddDdddddpddd",
    "dddDdddddedddddd",
    "dddddpddddddddDd",
    "dDddddddddDddddd",
    "dddddddDdddddded",
    "ddpdddddddDddddd",
    "ddddDddddddddDdd",
    "deddddpddddddddd",
    "ddddddddddDddpdd",
  ],
};

/**
 * What the camera sees of the top of a rock block: a surface, not a wall.
 *
 * This tile used to carry the same staggered courses as the face, and on screen
 * an outcrop read as brickwork lying flat rather than as blocks standing up —
 * the vertical mortar lines are the tell, because a top surface seen from a
 * pitched-back camera has no verticals in it at all. What it has is a dark back
 * lip where the step behind it occludes the light, a catch-light on that lip,
 * and mottling with no alignment to anything. Rock cells tile in both axes, so
 * the lip repeats every `TILE_DEPTH` down an outcrop and reads as strata.
 */
export const WALL_TOP: PixelSpriteSource = {
  palette: TERRAIN_PALETTE,
  rows: [
    "kkkkkkkkkkkkkkkk",
    "RRRrRRRRRRRrRRRR",
    "rrRrrrrrRrrkrRrr",
    "rrrrRrrrrrrRrrrr",
    "RrrrrrrRrrrrrrrR",
    "rrrRrrkrrrRrrrrr",
    "rrrrrrRrrrrrrRrr",
    "RrrRrrrrRrrrrrrr",
    "rrrrrRrrrrkrRrrR",
    "rRrrrrrrrRrrrrrr",
    "rrrrRrrRrrrrkrRr",
    "rrRrrrrrrrrRrrrr",
  ],
};

/**
 * Two courses of staggered rock, and nothing that reads as "the bottom".
 *
 * A face tile stacks upward as many times as the wall is tall, so any band
 * inside it — a contact shadow, a highlight — becomes a stripe every sixteen
 * pixels. The shadow where the wall meets the ground is drawn once, by whatever
 * sits at its foot, and is not this tile's business.
 */
export const WALL_FACE: PixelSpriteSource = {
  palette: TERRAIN_PALETTE,
  rows: [
    "mmmmmmmmmmmmmmmm",
    "mfffffffmfffffff",
    "mfffffffmfffffff",
    "mFFFFFFFmFFFFFFF",
    "mfffffffmfffffff",
    "mfffffffmfffffff",
    "mfffffffmfffffff",
    "mfffffffmfffffff",
    "mmmmmmmmmmmmmmmm",
    "fffmfffffffmffff",
    "fffmfffffffmffff",
    "FFFmFFFFFFFmFFFF",
    "fffmfffffffmffff",
    "fffmfffffffmffff",
    "fffmfffffffmffff",
    "fffmfffffffmffff",
  ],
};

/** Tiles that lie on the ground plane: 16 x TILE_DEPTH. */
export const GROUND_TILES: readonly PixelSpriteSource[] = [GRASS, DIRT_PATH, WALL_TOP];

/** Tiles that stand up the screen: 16 x WALL_RISE. */
export const STANDING_TILES: readonly PixelSpriteSource[] = [WALL_FACE];

export const ALL_TILES: readonly PixelSpriteSource[] = [...GROUND_TILES, ...STANDING_TILES];
