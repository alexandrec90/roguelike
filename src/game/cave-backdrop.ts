/**
 * The inside of a cave, as a backdrop for the band above the field.
 *
 * One lap of wall, `PANORAMA_WIDTH` columns round, at a bearing like the sky's
 * ridge - so strafing, which turns the world, sweeps the wall past, and the
 * torches on it come back round after a lap:
 *
 *     ceiling        dark rock, with stalactites hanging from it at hashed columns
 *     wall           courses of stone, each stone its own tone, mortar between
 *     torches        a bracket and a flame, flickering; each pushes a light
 *     foot           rubble where the wall meets the floor
 *
 * Every mark is seeded and every noise loops on the lap (`loopNoise`), so
 * column 1279 meets column 0 without a seam. The wall is inked once per band
 * height into a lap-wide buffer; a frame copies its window out and draws the
 * flames over it.
 *
 * Drawn in its own colours and lit like the world: the cave's dim ambient and
 * the torches' pools are the lighting pass's (`lighting-layer.ts`), so a stone
 * by a torch is bright and one between them is not, and nothing here darkens
 * itself.
 */

import type { Backdrop, BackdropView } from "./backdrop";
import { INK_COLORS, type InkId, type PixelCloud } from "./ink";
import { flicker, type LightSource } from "./lights";
import { landmarkX, PANORAMA_WIDTH, panoramaColumn, wrapPanorama } from "./panorama";
import { blendInk, createBuffer, paintInto, type PixelBuffer } from "./pixel-buffer";
import { valueNoise2 } from "./procgen/noise";
import { CAVE } from "./realm";
import { rampInk } from "./shading";
import { pixelHash } from "./transforms";

const SEED = 0xc0a7;

/** The cave's multiply colour: dim and cool, so the torches are what you see by. */
export const CAVE_AMBIENT = "#6a6680";

/** Panorama columns between torches, before jitter: eight to a lap. */
const TORCH_SPACING = 160;

export const TORCH_COUNT = PANORAMA_WIDTH / TORCH_SPACING;

/** A torch's reach on the world, logical pixels. */
const TORCH_RADIUS = 52;

/** A torch's flame is re-drawn this often, ms. */
const FLAME_TICK_MS = 90;

/** Rows of stone in a course. */
const COURSE = 5;

/** Columns in a stone; divides the lap, so the stones close on themselves. */
const STONE = 10;

const WALL: readonly InkId[] = ["stone-1", "stone-2", "stone-3", "stone-4"];
const CEILING: readonly InkId[] = ["stone-0", "stone-1"];
const RUBBLE: readonly InkId[] = ["earth-0", "earth-1", "stone-1", "earth-2"];

/** Smooth noise along the lap, 0..1, `cells` lattice cells to a lap: column 1279 meets column 0. */
export function loopNoise(u: number, cells: number, seed: number): number {
  const at = (wrapPanorama(u) / PANORAMA_WIDTH) * cells;
  const left = Math.floor(at);
  const t = at - left;
  const fade = t * t * (3 - 2 * t);
  const a = pixelHash(left % cells, 0, seed);
  const b = pixelHash((left + 1) % cells, 0, seed);
  return a + (b - a) * fade;
}

/** How far down a stalactite hangs at a column, rows below the ceiling; 0 for none. */
function stalactite(u: number): number {
  let deepest = 0;
  for (let k = -3; k <= 3; k += 1) {
    const centre = wrapPanorama(Math.round(u) + k);
    if (pixelHash(centre, 1, SEED) >= 0.07) {
      continue;
    }
    const length = 3 + pixelHash(centre, 2, SEED) * 10;
    const halfWidth = 1.5 + pixelHash(centre, 3, SEED) * 1.5;
    deepest = Math.max(deepest, length * (1 - Math.abs(k) / halfWidth));
  }
  return deepest;
}

/** Rows of rock from the top of the band at a column, stalactites included. */
export function ceilingDepth(u: number, height: number): number {
  const base = height * 0.08 + loopNoise(u, 40, SEED ^ 0x11) * height * 0.12;
  return base + stalactite(u);
}

/** Rows of rubble up from the bottom of the band at a column. */
export function rubbleHeight(u: number, height: number): number {
  return 1 + loopNoise(u, 64, SEED ^ 0x22) * height * 0.08 + loopNoise(u, 320, SEED ^ 0x23) * 2;
}

/** The ink at panorama column `u`, row `y` of a band `height` rows tall. */
export function caveWallInk(column: number, y: number, height: number): InkId {
  const u = wrapPanorama(column);
  const ceiling = ceilingDepth(u, height);
  if (y < ceiling) {
    return rampInk(CEILING, y < ceiling - 1 ? 0 : 1);
  }
  const fromFloor = height - 1 - y;
  if (fromFloor < rubbleHeight(u, height)) {
    // Blocky rather than smooth: a hash per two-pixel cell closes on the lap where noise would not.
    const grain = pixelHash(Math.floor(u / 2), Math.floor(y / 2), SEED ^ 0x33);
    return rampInk(RUBBLE, grain, { x: u, y });
  }
  const course = Math.floor(fromFloor / COURSE);
  const shifted = wrapPanorama(u + Math.floor(pixelHash(course, 4, SEED) * STONE));
  const stone = Math.floor(shifted / STONE);
  if (fromFloor % COURSE === 0 || shifted % STONE === 0) {
    return "stone-0";
  }
  if (pixelHash(stone, course, SEED ^ 0x44) < 0.04) {
    return "moss-1";
  }
  // Lighter toward the floor: the far wall's foot is where the torchlight pools.
  const level = 0.2 + pixelHash(stone, course, SEED ^ 0x55) * 0.4 + (y / height) * 0.3;
  return rampInk(WALL, level, { x: u, y });
}

/** Where torch `index` hangs on the lap, and its flame's seed. */
export function torchColumn(index: number): number {
  return wrapPanorama(index * TORCH_SPACING + 40 + Math.floor(pixelHash(index, 5, SEED) * 80));
}

/** The row a torch's bracket is fixed at, for a band this tall. */
export function torchRow(height: number): number {
  return Math.round(height * 0.55);
}

/**
 * One torch, foot-anchored at its bracket: an iron bracket and cup, and a
 * flame over it whose height and lean wander on seeded noise in time.
 */
export function torchCloud(elapsedMs: number, seed: number): PixelCloud {
  const cloud: PixelCloud = [
    { x: 0, y: 0, ink: "metal-0" },
    { x: 0, y: -1, ink: "metal-1" },
    { x: 0, y: -2, ink: "metal-1" },
    { x: -1, y: -3, ink: "metal-1" },
    { x: 0, y: -3, ink: "bark-2" },
    { x: 1, y: -3, ink: "metal-1" },
  ];
  const t = elapsedMs / 110;
  const tall = 3 + Math.round(valueNoise2(t, 0.5, seed) * 3);
  const lean = Math.round((valueNoise2(t * 0.7, 3.5, seed ^ 0x9) - 0.5) * 2);
  for (let row = 0; row < tall; row += 1) {
    const y = -4 - row;
    const share = row / tall;
    const sway = share > 0.5 ? lean : 0;
    const half = share < 0.6 ? 1 : 0;
    for (let x = -half; x <= half; x += 1) {
      const core = x === 0 && share < 0.5;
      cloud.push({ x: x + sway, y, ink: core ? "fire-6" : share < 0.7 ? "fire-5" : "fire-4" });
    }
  }
  cloud.push({ x: lean, y: -4 - tall, ink: "fire-3" });
  return cloud;
}

/** The lap of wall inked for one band height, kept: the walls do not change. */
function lapFor(height: number): PixelBuffer {
  let lap = LAPS.get(height);
  if (lap === undefined) {
    lap = createBuffer(PANORAMA_WIDTH, height);
    for (let y = 0; y < height; y += 1) {
      for (let u = 0; u < PANORAMA_WIDTH; u += 1) {
        blendInk(lap, u, y, caveWallInk(u, y, height));
      }
    }
    LAPS.set(height, lap);
  }
  return lap;
}

const LAPS = new Map<number, PixelBuffer>();

/** Every torch whose flame is on screen, and where. */
function torchesInView(view: BackdropView): { readonly x: number; readonly index: number }[] {
  const found: { x: number; index: number }[] = [];
  for (let index = 0; index < TORCH_COUNT; index += 1) {
    const x = landmarkX(torchColumn(index), view.offset);
    if (x > -4 && x < view.width + 4) {
      found.push({ x, index });
    }
  }
  return found;
}

export const CAVE_BACKDROP: Backdrop = {
  id: CAVE,
  ambient: CAVE_AMBIENT,

  signature(view: BackdropView): string {
    return `${view.width}x${view.height}|${view.offset}|${Math.floor(view.elapsedMs / FLAME_TICK_MS)}`;
  },

  paint(buffer: PixelBuffer, view: BackdropView): void {
    const lap = lapFor(view.height);
    const out = buffer.data;
    for (let x = 0; x < view.width; x += 1) {
      const u = panoramaColumn(x, view.offset);
      for (let y = 0; y < view.height; y += 1) {
        const from = (y * PANORAMA_WIDTH + u) * 4;
        out.set(lap.data.subarray(from, from + 4), (y * buffer.width + x) * 4);
      }
    }
    const row = torchRow(view.height);
    const tick = Math.floor(view.elapsedMs / FLAME_TICK_MS) * FLAME_TICK_MS;
    for (const torch of torchesInView(view)) {
      paintInto(buffer, torchCloud(tick, SEED + torch.index * 97), torch.x, row);
    }
  },

  lights(view: BackdropView): LightSource[] {
    const row = torchRow(view.height);
    return torchesInView(view).map((torch) => ({
      x: torch.x,
      y: row - 5,
      radius: TORCH_RADIUS,
      color: INK_COLORS["fire-5"],
      intensity: 0.95 * flicker(view.elapsedMs, SEED + torch.index * 97),
    }));
  },
};
