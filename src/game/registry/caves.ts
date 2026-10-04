/**
 * Asset-lab entries: caves - the mouth on the overworld, and the inside.
 *
 * One file per area so work on one never has to edit another's list;
 * `asset-registry.ts` spreads them all into `ASSET_REGISTRY`.
 *
 * Nothing here is drawn: the mouth is `caveEntranceCloud` at the scales the
 * horizon roll asks for, the wall is a window of `CAVE_BACKDROP`'s lap with
 * its torches at fixed instants, and the floor is `floorTileCloud` laid out the
 * way the chamber lays it.
 */

import { AUTHORED, type AssetEntry } from "../asset-types";
import { caveWallInk, torchCloud, torchColumn, torchRow } from "../cave-backdrop";
import { caveEntranceCloud, ENTRANCE_HALF_WIDTH, ENTRANCE_HEIGHT } from "../cave-entrance-art";
import { floorTileCloud, FLOOR_VARIANTS, type FloorKey } from "../cave-floor";
import { cloudToSprite, type InkId, type PixelCloud } from "../ink";
import type { PixelSpriteSource } from "../pixel-art";
import { TILE_DEPTH, TILE_WIDTH } from "../projection";
import { inkSwap } from "./fire";

const NOON = { light: { x: -0.6, y: -0.8 }, elevation: 0.8 };

/** The mouth on the field, then on the roll at the sizes a walk toward the horizon passes through. */
const MOUTH_SCALES = [1, 0.7, 0.45, 0.25];
const MOUTH_FRAME = { width: ENTRANCE_HALF_WIDTH * 2 + 3, height: ENTRANCE_HEIGHT + 5, originX: ENTRANCE_HALF_WIDTH + 1, originY: ENTRANCE_HEIGHT + 1 };
const MOUTH_FRAMES = MOUTH_SCALES.map((scale) => cloudToSprite(caveEntranceCloud(scale, NOON), MOUTH_FRAME));

/** A band as tall as the default layout's, and a screen of it wide around the first torch. */
const WALL = { width: 160, height: 40 };
const WALL_START = torchColumn(0) - 60;

function wallCloud(elapsedMs: number): PixelCloud {
  const cloud: PixelCloud = [];
  for (let y = 0; y < WALL.height; y += 1) {
    for (let x = 0; x < WALL.width; x += 1) {
      cloud.push({ x, y, ink: caveWallInk(WALL_START + x, y, WALL.height) });
    }
  }
  const torch = torchCloud(elapsedMs, 0xc0a7);
  return [...cloud, ...torch.map((pixel) => ({ ...pixel, x: pixel.x + 60, y: pixel.y + torchRow(WALL.height) }))];
}

const WALL_FRAMES = [0, 180, 360, 540, 720, 900].map((ms) =>
  cloudToSprite(wallCloud(ms), { width: WALL.width, height: WALL.height, originX: 0, originY: 0 }),
);

/** Five tiles by four: every stone variant, the lit stone at the mouth, and rock past the wall. */
function floorCloud(): PixelCloud {
  const rows: FloorKey[][] = [
    [0, 1, 2, 3, 0].map((variant) => ({ kind: "stone", variant: variant % FLOOR_VARIANTS })),
    [{ kind: "stone", variant: 2 }, { kind: "lit", variant: 0 }, { kind: "lit", variant: 0 }, { kind: "stone", variant: 1 }, { kind: "stone", variant: 3 }],
    [{ kind: "stone", variant: 3 }, { kind: "lit", variant: 0 }, { kind: "stone", variant: 0 }, { kind: "stone", variant: 2 }, { kind: "rock", variant: 0 }],
    [{ kind: "rock", variant: 0 }, { kind: "stone", variant: 1 }, { kind: "rock", variant: 0 }, { kind: "rock", variant: 0 }, { kind: "rock", variant: 0 }],
  ];
  return rows.flatMap((row, ty) =>
    row.flatMap((key, tx) => floorTileCloud(key).map((pixel) => ({ ...pixel, x: pixel.x + tx * TILE_WIDTH, y: pixel.y + ty * TILE_DEPTH }))),
  );
}

const FLOOR_FRAMES = [cloudToSprite(floorCloud(), { width: TILE_WIDTH * 5, height: TILE_DEPTH * 4, originX: 0, originY: 0 })];

/** Stone re-inked as sandstone: what a desert's caves would be cut from. */
const SANDSTONE: Partial<Record<InkId, InkId>> = {
  "stone-1": "earth-1",
  "stone-2": "earth-2",
  "stone-3": "earth-3",
  "stone-4": "earth-4",
  "stone-5": "earth-5",
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
    id: "cave-wall",
    label: "Cave — the wall the horizon shows inside",
    category: "prop",
    frames: WALL_FRAMES,
    frameDurationMs: 90,
    variants: variants(WALL_FRAMES),
    notes:
      "A window of the backdrop's lap round its first torch, the flame sampled every 180 ms. In the game the " +
      "cave's dim ambient and each torch's pool light it; here it is in its own colours.",
  },
  {
    id: "cave-floor",
    label: "Cave — chamber floor tiles",
    category: "prop",
    frames: FLOOR_FRAMES,
    frameDurationMs: 1000,
    variants: variants(FLOOR_FRAMES),
    notes: "Every stone variant, the lit stone round the way out, and the rock past the chamber's wall. No seam should be findable between stones.",
  },
];
