import type { Palette, PixelSpriteSource } from "./pixel-art";

const HERO_PALETTE: Palette = {
  ".": null,
  h: "#251c22",
  H: "#684337",
  f: "#f0ba7d",
  n: "#b75c46",
  c: "#1b2735",
  C: "#416a71",
  w: "#d6e1c7",
  b: "#352a36",
  B: "#15141c",
};

const SLIME_PALETTE: Palette = {
  ".": null,
  g: "#172c2c",
  G: "#4b9a72",
  l: "#78c985",
  w: "#e1efbd",
  d: "#243a36",
  s: "#182125",
};

const TORCH_PALETTE: Palette = {
  ".": null,
  y: "#ffe082",
  Y: "#fff2b0",
  o: "#ef7e36",
  r: "#a9392d",
  b: "#674533",
  d: "#2b2427",
};

export const HERO: PixelSpriteSource = {
  palette: HERO_PALETTE,
  rows: [
    "................",
    "....hhhhh.......",
    "...hHHHHHh......",
    "...hHfHfHh......",
    "...hHHnHHh......",
    "....hHHHh.......",
    ".....hHh........",
    "....cccccc......",
    "...ccCCCCcc.....",
    "...cCCCCCCc.....",
    "...cCwCCwCc.....",
    "...cCCCCCCc.....",
    "....CCCCCC......",
    "....CC..CC......",
    "...bb....bb.....",
    "...bb....bb.....",
    "...bb....bb.....",
    "..BBB....BBB....",
    "..BBB....BBB....",
    "................",
  ],
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
  P: "#2b3a4a",
  Q: "#333f4d",
  q: "#c9a05a",
};

export const FAR_PINE: PixelSpriteSource = {
  palette: DISTANT_PALETTE,
  rows: ["..P..", ".PPP.", ".PPP.", "PPPPP", "..P..", "..P.."],
};

export const FAR_TOWER: PixelSpriteSource = {
  palette: DISTANT_PALETTE,
  rows: ["Q.Q.Q", "QQQQQ", "QQQQQ", "QQqQQ", "QQQQQ", "QQQQQ"],
};

export const ALL_SPRITES: readonly PixelSpriteSource[] = [
  HERO,
  ...SLIME_FRAMES,
  ...TORCH_FRAMES,
  SPARK,
  FAR_PINE,
  FAR_TOWER,
];
