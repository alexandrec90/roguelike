/**
 * What a cave shows above its horizon line: the dark, and the roof.
 *
 * Under the sky the band above the horizon line is the sky. In a cave it is
 * the cave's own far dark - rock overhead with stalactites hanging from it,
 * then nothing - and everything you can walk to (the floor over the lip, the
 * walls, the torches, the far end) is the cave's world, drawn below and up
 * through it by `cave-march.ts`. A wall far down the tunnel stands up past the
 * horizon line against this.
 *
 * One lap, `PANORAMA_WIDTH` columns round, at a bearing like the sky's ridge,
 * so strafing sweeps the stalactites past. Every mark is seeded and every noise
 * loops on the lap (`loopNoise`), so column 1279 meets column 0 without a seam.
 *
 * Also the torch flame (`torchCloud`), which the march sets on the walls.
 */

import type { Backdrop, BackdropView } from "./backdrop";
import type { InkId, PixelCloud } from "./ink";
import { PANORAMA_WIDTH, panoramaColumn, wrapPanorama } from "./panorama";
import { blendInk, createBuffer, type PixelBuffer } from "./pixel-buffer";
import { valueNoise2 } from "./procgen/noise";
import { CAVE } from "./realm";
import { ditherThreshold } from "./shading";
import { pixelHash } from "./transforms";

const SEED = 0xc0a7;

/** The cave's multiply colour: dim and cool, so the torches are what you see by. */
export const CAVE_AMBIENT = "#8a86a0";

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

/** How far down a stalactite hangs at a column, rows below the roof; 0 for none. */
function stalactite(u: number): number {
  let deepest = 0;
  for (let k = -3; k <= 3; k += 1) {
    const centre = wrapPanorama(Math.round(u) + k);
    if (pixelHash(centre, 1, SEED) >= 0.07) {
      continue;
    }
    const length = 3 + pixelHash(centre, 2, SEED) * 8;
    const halfWidth = 1.5 + pixelHash(centre, 3, SEED) * 1.5;
    deepest = Math.max(deepest, length * (1 - Math.abs(k) / halfWidth));
  }
  return deepest;
}

/** Rows of rock from the top of the band at a column, stalactites included. */
export function ceilingDepth(u: number, height: number): number {
  return height * 0.12 + loopNoise(u, 40, SEED ^ 0x11) * height * 0.18 + stalactite(u);
}

/**
 * The ink at panorama column `u`, row `y` of a band `height` rows tall: the
 * roof's rock, its lit lower edge, then the dark - flecked faintly toward the
 * horizon line, where the far rock is.
 */
export function caveCeilingInk(column: number, y: number, height: number): InkId {
  const u = wrapPanorama(column);
  const roof = ceilingDepth(u, height);
  if (y < roof - 1) {
    return pixelHash(u, y, SEED ^ 0x5) < 0.15 ? "stone-1" : "stone-0";
  }
  if (y < roof) {
    return "stone-1";
  }
  const toLine = y / Math.max(height - 1, 1);
  return toLine * 0.35 > ditherThreshold(u, y) ? "stone-0" : "void";
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

/** The lap of roof inked for one band height, kept: the roof does not change. */
function lapFor(height: number): PixelBuffer {
  let lap = LAPS.get(height);
  if (lap === undefined) {
    lap = createBuffer(PANORAMA_WIDTH, height);
    for (let y = 0; y < height; y += 1) {
      for (let u = 0; u < PANORAMA_WIDTH; u += 1) {
        blendInk(lap, u, y, caveCeilingInk(u, y, height));
      }
    }
    LAPS.set(height, lap);
  }
  return lap;
}

const LAPS = new Map<number, PixelBuffer>();

export const CAVE_BACKDROP: Backdrop = {
  id: CAVE,
  ambient: CAVE_AMBIENT,

  signature(view: BackdropView): string {
    return `${view.width}x${view.height}|${view.offset}`;
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
  },

  lights(): [] {
    return [];
  },
};
