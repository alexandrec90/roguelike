/**
 * Asset-lab entries: caves - the mouth on the overworld, and the inside.
 *
 * One file per area so work on one never has to edit another's list;
 * `asset-registry.ts` spreads them all into `ASSET_REGISTRY`.
 *
 * Nothing here is drawn: the mouth is `caveEntranceCloud` at the scales the
 * horizon roll asks for, the roof is a window of `CAVE_BACKDROP`'s lap, and the
 * inside is `caveClouds` - the very march the game draws - from fixed points
 * down one cave, from the mouth to its end.
 */

import { AUTHORED, type AssetEntry } from "../asset-types";
import { caveCeilingInk } from "../cave-backdrop";
import { caveEntranceCloud, ENTRANCE_HALF_WIDTH, ENTRANCE_HEIGHT } from "../cave-entrance-art";
import { buildMap, tunnelCentre } from "../cave-map";
import { caveClouds } from "../cave-march";
import { horizonLayout } from "../horizon";
import { cloudToSprite, type InkId, type PixelCloud } from "../ink";
import type { PixelSpriteSource } from "../pixel-art";
import { fromLocal } from "../planet";
import { inkSwap } from "./fire";

const NOON = { light: { x: -0.6, y: -0.8 }, elevation: 0.8 };

/** The mouth on the field, then on the roll at the sizes a walk toward the horizon passes through. */
const MOUTH_SCALES = [1, 0.7, 0.45, 0.25];
const MOUTH_FRAME = {
  width: ENTRANCE_HALF_WIDTH * 2 + 3,
  height: ENTRANCE_HEIGHT + 5,
  originX: ENTRANCE_HALF_WIDTH + 1,
  originY: ENTRANCE_HEIGHT + 1,
};
const MOUTH_FRAMES = MOUTH_SCALES.map((scale) => cloudToSprite(caveEntranceCloud(scale, NOON), MOUTH_FRAME));

/** The default layout's band above the horizon line, a screen wide. */
const LAYOUT = horizonLayout(180, 0.22);
const ROOF = { width: 320, height: LAYOUT.horizonY };

function roofCloud(start: number): PixelCloud {
  const cloud: PixelCloud = [];
  for (let y = 0; y < ROOF.height; y += 1) {
    for (let x = 0; x < ROOF.width; x += 1) {
      cloud.push({ x, y, ink: caveCeilingInk(start + x, y, ROOF.height) });
    }
  }
  return cloud;
}

const ROOF_FRAMES = [0, 320, 640, 960].map((start) =>
  cloudToSprite(roofCloud(start), { width: ROOF.width, height: ROOF.height, originX: 0, originY: 0 }),
);

/** One cave, walked into: at the mouth, a third in, near the end, at the end. */
const SEED = 6607;
const MAP = buildMap(SEED);
const ENTRY = { x: 128, y: 128, turn: 0 };
// Half a screen wide: the lab lays every frame out twice across its 320 columns, dark ground and light.
const INSIDE = { width: 160, height: 180 };
const FRAME = { groundTop: LAYOUT.groundTop, rollHeight: LAYOUT.rollHeight, footX: 80, footY: 120, phaseX: 0, phaseY: 0 };

function insideCloud(along: number): PixelCloud {
  const at = fromLocal(ENTRY, { x: Math.round(tunnelCentre(SEED, along)), y: along });
  const view = { frame: FRAME, pose: { ...at, turn: 0 }, entry: ENTRY, map: MAP, elapsedMs: 0 };
  const { back, front } = caveClouds(view, INSIDE.width, INSIDE.height);
  return [...back, ...front];
}

const INSIDE_FRAMES = [0, Math.round(MAP.length / 3), MAP.length - 14, MAP.length - 2].map((along) =>
  cloudToSprite(insideCloud(along), { width: INSIDE.width, height: INSIDE.height, originX: 0, originY: 0 }),
);

/** Stone re-inked as sandstone: what a desert's caves would be cut from. */
const SANDSTONE: Partial<Record<InkId, InkId>> = {
  "stone-1": "earth-1",
  "stone-2": "earth-2",
  "stone-3": "earth-3",
  "stone-4": "earth-4",
};

function variants(frames: readonly PixelSpriteSource[]) {
  return [AUTHORED, inkSwap("sandstone", "Sandstone", frames, SANDSTONE)];
}

export const CAVE_ASSETS: readonly AssetEntry[] = [
  {
    id: "cave-mouth",
    label: "Cave — mouth (field, then the horizon roll)",
    category: "prop",
    frames: MOUTH_FRAMES,
    frameDurationMs: 400,
    variants: variants(MOUTH_FRAMES),
    notes:
      "One description at four scales, never a shrunk sprite: each frame evaluates the mound and its arch at " +
      "its own pixels, so the dither stays on the grid. It faces the camera from every heading. Check the arch " +
      "reads as an opening at every size and the contact shadow sits under the foot.",
  },
  {
    id: "cave-roof",
    label: "Cave — the roof above the horizon line",
    category: "prop",
    frames: ROOF_FRAMES,
    frameDurationMs: 600,
    variants: variants(ROOF_FRAMES),
    notes: "A quarter of the lap a frame. Stalactites hang from the rock; below them the cave's far dark.",
  },
  {
    id: "cave-inside",
    label: "Cave — inside, from the mouth to the end",
    category: "prop",
    frames: INSIDE_FRAMES,
    frameDurationMs: 800,
    variants: variants(INSIDE_FRAMES),
    notes:
      "The game's own march from four points down one cave, in its own colours (the game lights it dimly, with " +
      "a pool round each torch). The floor carries over the horizon's lip, the walls shrink up it, and the last " +
      "two frames show the end chamber coming down off the horizon onto the field.",
  },
];
