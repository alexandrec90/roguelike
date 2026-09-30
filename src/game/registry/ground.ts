/**
 * Asset-lab entries: Ground tiles, grass and ground cover.
 *
 * One file per area so work on one never has to edit another's list;
 * `asset-registry.ts` spreads them all into `ASSET_REGISTRY`.
 *
 * Everything here is generated (`src/game/ground/`), so an entry is a handful
 * of keys run through the same functions the layers call. The meadow entry is
 * the one to look at first: a whole field composed the way the game composes
 * it, played through the wind.
 */

import type { AssetEntry, PaletteVariant } from "../asset-types";
import { AUTHORED } from "../asset-types";
import { composeField, demoTerrain, syntheticSample } from "../ground/field-preview";
import { groundTile } from "../ground/ground-tiles";
import { gridToSprite } from "../ground/ink-grid";
import { capTile, faceTile } from "../ground/rock-tiles";
import { BEND_FRAMES, bendFrame, TUFT_FRAME, TUFT_KINDS, TUFT_SHAPES, tuftCloud } from "../ground/tufts";
import { cloudToSprite, INK_COLORS, INK_TOKENS, type InkId } from "../ink";
import { familyRamp, type Family } from "../palette";
import type { PixelSpriteSource } from "../pixel-art";

/**
 * A palette swap from one family onto another, restricted to the tokens every
 * frame actually uses - the registry rejects a variant aimed at an unused token.
 */
function familySwap(
  id: string,
  label: string,
  frames: readonly PixelSpriteSource[],
  swaps: readonly (readonly [Family, Family])[],
): PaletteVariant {
  const overrides: Record<string, string> = {};
  for (const [from, to] of swaps) {
    const target = familyRamp(to);
    familyRamp(from).forEach((ink, index) => {
      const token = INK_TOKENS[ink];
      const onto = target[Math.min(index, target.length - 1)] as InkId;
      if (frames.every((frame) => token in frame.palette)) {
        overrides[token] = INK_COLORS[onto];
      }
    });
  }
  return { id, label, overrides };
}

const GRASS_FRAMES = Array.from({ length: 8 }, (_unused, middle) =>
  gridToSprite(groundTile({ dirt: 0, colours: (middle * 0x5b) & 0x1ef, middle, shade: 0 })),
);

/** Path masks, row-major from the far edge: straight, across, diagonal, a bend, an end, all earth. */
const PATH_MASKS = [0b010010010, 0b000111000, 0b100010001, 0b000011010, 0b000010010, 0b111111111, 0b110111011];
const PATH_FRAMES = PATH_MASKS.map((dirt, index) =>
  gridToSprite(groundTile({ dirt, colours: index * 37, middle: index % 8, shade: index === 1 ? 2 : 0 })),
);

const CAP_FRAMES = Array.from({ length: 16 }, (_unused, rock) =>
  gridToSprite(capTile({ rock, colours: rock * 29, middle: rock % 8 })),
);

const FACE_FRAMES = [
  { openLeft: true, openRight: true },
  { openLeft: true, openRight: false },
  { openLeft: false, openRight: false },
  { openLeft: false, openRight: true },
].map((ends, index) => gridToSprite(faceTile({ ...ends, colours: index * 3, middle: index })));

const TUFT_BEND_FRAMES = Array.from({ length: BEND_FRAMES }, (_unused, bend) =>
  cloudToSprite(tuftCloud(TUFT_SHAPES[6] ?? TUFT_SHAPES[0]!, bend), TUFT_FRAME),
);

const TUFT_GALLERY = TUFT_SHAPES.map((shape) => cloudToSprite(tuftCloud(shape, bendFrame(0)), TUFT_FRAME));

const MEADOW = syntheticSample(14, 9, demoTerrain);
const MEADOW_FRAMES = Array.from({ length: 12 }, (_unused, index) => gridToSprite(composeField(MEADOW, index * 180)));

export const GROUND_ASSETS: readonly AssetEntry[] = [
  {
    id: "ground-meadow",
    label: "Ground — meadow, path and outcrop (composed)",
    category: "prop",
    frames: MEADOW_FRAMES,
    frameDurationMs: 180,
    notes:
      "A 14x9-cell field composed exactly as the layers compose it: Wang-tiled ground, a path " +
      "following a sampled contour, a rock outcrop, and tufts bent by the wind field. Play it: the " +
      "gust should roll across the meadow as a wave, and no tile edge should be findable.",
    variants: [
      AUTHORED,
      familySwap("autumn", "Autumn", MEADOW_FRAMES, [["grass", "autumn"], ["meadow", "autumn"]]),
    ],
  },
  {
    id: "ground-grass-tiles",
    label: "Ground — grass variants",
    category: "tile",
    frames: GRASS_FRAMES,
    frameDurationMs: 400,
    notes:
      "16x12 ground, one frame per middle colour. Tiled 3x3 each must show no seam: the Wang " +
      "nodes on its edges agree with themselves, and in the game with any neighbour.",
    variants: [AUTHORED, familySwap("autumn", "Autumn", GRASS_FRAMES, [["grass", "autumn"]])],
  },
  {
    id: "ground-path-edges",
    label: "Ground — path border masks",
    category: "tile",
    frames: PATH_FRAMES,
    frameDurationMs: 500,
    notes:
      "Path cells by lattice mask: straight, across (with a rock's contact shadow on top), " +
      "diagonal, a bend, an end, all earth, and a junction. Grass overhangs the earth; the border " +
      "is organic, never a straight tile edge.",
    variants: [AUTHORED, familySwap("ashen", "Ashen", PATH_FRAMES, [["earth", "stone"]])],
  },
  {
    id: "ground-rock-cap",
    label: "Rock — cap by neighbour mask",
    category: "tile",
    frames: CAP_FRAMES,
    frameDurationMs: 400,
    notes:
      "Frame n is the cap with rock neighbours n (1 behind, 2 right, 4 in front, 8 left). Open " +
      "sides get the rim - lit left and back, dark right - moss grows along the lit rims, and a " +
      "corner with both sides open is chipped round. No vertical lines anywhere.",
    variants: [AUTHORED, familySwap("sandstone", "Sandstone", CAP_FRAMES, [["stone", "earth"]])],
  },
  {
    id: "ground-rock-face",
    label: "Rock — cliff face ends",
    category: "tile",
    frames: FACE_FRAMES,
    frameDurationMs: 500,
    notes:
      "16x16 faces: both ends open, left end, middle, right end. Vertical strata, darker toward " +
      "the foot, a lit lip with moss dripping over it. No contact shadow - the ground draws that.",
    variants: [AUTHORED, familySwap("sandstone", "Sandstone", FACE_FRAMES, [["stone", "earth"]])],
  },
  {
    id: "grass-tuft-bend",
    label: "Grass — one tuft through every bend",
    category: "prop",
    frames: TUFT_BEND_FRAMES,
    frameDurationMs: 160,
    notes:
      "Frames 0-6 bend the tips from -3 to +3 px (roots fixed, bend grows with height squared); " +
      "7 and 8 are the tuft trodden flat to either side.",
    variants: [AUTHORED, familySwap("autumn", "Autumn", TUFT_BEND_FRAMES, [["grass", "autumn"]])],
  },
  {
    id: "grass-tuft-shapes",
    label: `Grass — the ${TUFT_KINDS.length} tuft shapes`,
    category: "prop",
    frames: TUFT_GALLERY,
    frameDurationMs: 500,
    notes: `Upright, in atlas order: ${TUFT_KINDS.join(", ")}.`,
    variants: [AUTHORED, familySwap("autumn", "Autumn", TUFT_GALLERY, [["grass", "autumn"]])],
  },
];
