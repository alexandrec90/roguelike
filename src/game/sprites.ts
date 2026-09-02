/**
 * Hand-drawn raster sprites, re-inked for the 1-bit direction: pitch black
 * carries the scene, so a sprite is a neon outline with a near-black fill and
 * at most one or two accent colours. The hero is no longer here — characters
 * are rigs now (`models.ts`); what remains raster is what has no limbs to
 * animate: props, effects sources, and distant silhouettes.
 */

import type { Palette, PixelSpriteSource } from "./pixel-art";
import { sampleDistantPineFrames } from "./vegetation";

const SLIME_PALETTE: Palette = {
  ".": null,
  g: "#2ee868",
  G: "#03170b",
  l: "#0c2f18",
  w: "#eaffea",
  d: "#000000",
  s: "#0d1f14",
};

const TORCH_PALETTE: Palette = {
  ".": null,
  y: "#ffd23d",
  Y: "#fff7c8",
  o: "#ff7a1f",
  r: "#c2320f",
  b: "#4a5a74",
  d: "#000000",
};

export const SLIME_FRAMES: readonly PixelSpriteSource[] = [
  {
    palette: SLIME_PALETTE,
    rows: [
      "................",
      "................",
      ".....gg.........",
      "...ggGGgg.......",
      "..gGllllGg......",
      ".gGGlwGlwGGg....",
      ".gGGGGGGGGGg....",
      ".gGGdGGdGGGg....",
      "..gGGGGGGGg.....",
      "...gggggg.......",
      "....ssss........",
      "................",
    ],
  },
  {
    palette: SLIME_PALETTE,
    rows: [
      "................",
      "................",
      "................",
      "................",
      "...gggggg.......",
      "..gGllllGg......",
      ".gGGwGGwGGGg....",
      ".gGGGGGGGGGg....",
      "gGGGdGGdGGGGg...",
      ".ggGGGGGGgg.....",
      "..ssssssss......",
      "................",
    ],
  },
  {
    palette: SLIME_PALETTE,
    rows: [
      "................",
      "......gg........",
      ".....gGGg.......",
      "....gGllGg......",
      "...gGGGGGGg.....",
      "..gGGwGGwGGg....",
      "..gGGGGGGGGg....",
      "..gGGdGGdGGg....",
      "...gGGGGGGg.....",
      "....gggggg......",
      ".....ssss.......",
      "................",
    ],
  },
  {
    palette: SLIME_PALETTE,
    rows: [
      "................",
      "................",
      ".....gg.........",
      "...ggGGgg.......",
      "..gGllllGg......",
      ".gGGddddGGGg....",
      ".gGGGGGGGGGg....",
      ".gGGdGGdGGGg....",
      "..gGGGGGGGg.....",
      "...gggggg.......",
      "....ssss........",
      "................",
    ],
  },
];

export const TORCH_FRAMES: readonly PixelSpriteSource[] = [
  {
    palette: TORCH_PALETTE,
    rows: [
      "........",
      "....y...",
      "...yYy..",
      "..oYYY..",
      "..ooYo..",
      "...rr...",
      "...bb...",
      "..bddb..",
      "..bddb..",
      "...bb...",
      "...bb...",
      "........",
    ],
  },
  {
    palette: TORCH_PALETTE,
    rows: [
      "........",
      "..y.....",
      "..Yy....",
      "..YYo...",
      "..oYoo..",
      "...rr...",
      "...bb...",
      "..bddb..",
      "..bddb..",
      "...bb...",
      "...bb...",
      "........",
    ],
  },
  {
    palette: TORCH_PALETTE,
    rows: [
      "........",
      ".....y..",
      "....yY..",
      "...oYY..",
      "..ooYo..",
      "...rr...",
      "...bb...",
      "..bddb..",
      "..bddb..",
      "...bb...",
      "...bb...",
      "........",
    ],
  },
];

export const SPARK: PixelSpriteSource = {
  palette: { ".": null, x: "#ffd56b" },
  rows: ["x"],
};

/**
 * A raindrop streak, leaning the way the wind blows it.
 *
 * The bright head is the bottom-right pixel — where the drop *is* — and the
 * dim trail runs back up and to the left, because that is where it has been.
 * The lean is `RAIN_SLANT` from `weather.ts`, two columns across five rows;
 * `sprites.test.ts` measures it against that constant, so the art cannot drift
 * out of step with the motion it is drawn for.
 */
export const RAIN_STREAK: PixelSpriteSource = {
  palette: { ".": null, r: "#2a7fa8", R: "#7fd4f0" },
  rows: ["r..", "r..", ".r.", ".r.", "..r", "..R"],
};

/**
 * Landmarks beyond the horizon.
 *
 * These stand on the horizon line inside the rolled-over band, so they are
 * authored at the scale that band affords — five or six pixels — and read as
 * silhouette plus one lit window rather than as small versions of near art.
 * The ridge they stand on is generated noise (`ridgeProfile`); anything with an
 * identity is drawn, which is the split the art contract asks for.
 */
const DISTANT_PALETTE: Palette = {
  ".": null,
  Q: "#131a2b",
  q: "#ffd23d",
};

export const FAR_PINE_FRAMES = sampleDistantPineFrames();

export const FAR_TOWER: PixelSpriteSource = {
  palette: DISTANT_PALETTE,
  rows: ["Q.Q.Q", "QQQQQ", "QQQQQ", "QQqQQ", "QQQQQ", "QQQQQ"],
};

export const ALL_SPRITES: readonly PixelSpriteSource[] = [
  ...SLIME_FRAMES,
  ...TORCH_FRAMES,
  SPARK,
  RAIN_STREAK,
  ...FAR_PINE_FRAMES,
  FAR_TOWER,
];
