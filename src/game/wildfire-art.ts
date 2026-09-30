/**
 * What a burning tile of grass looks like, and the scar it leaves.
 *
 * Both are pure functions of a seed, the clock and a strength, so a hundred
 * burning cells cost no state and a capture at a time reproduces.
 *
 * A grass fire is not a campfire: it is low, ragged and many-tongued, a row of
 * short licks running along the ground rather than one tall body. Each tongue
 * is a narrowing column whose height wanders on its own noise, inked hottest at
 * the root and cooling to red at the tip, with the tips breaking off in a
 * dither so the fire reads as flickering rather than as a drawn shape.
 */

import type { InkId, PixelCloud } from "./ink";
import { rampSlice } from "./palette";
import { valueNoise2, valueNoise3 } from "./procgen/noise";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import { ditherThreshold, rampInk } from "./shading";
import { pixelHash } from "./transforms";

const FLAME: readonly InkId[] = rampSlice("fire", 2, 6);
const CHAR: readonly InkId[] = ["earth-0", "bark-0", "earth-1", "smoke-1"];
const EMBERS: readonly InkId[] = rampSlice("fire", 3, 5);

/** How many tongues a burning cell sends up. */
const TONGUES = 4;

/**
 * The flames of one burning cell, foot-anchored at the middle of the cell's
 * near edge. `strength` 0..1 is how hard it is burning (`flameAt`).
 */
export function grassFlameCloud(seed: number, elapsedMs: number, strength: number): PixelCloud {
  const cloud: PixelCloud = [];
  if (strength <= 0.02) {
    return cloud;
  }
  for (let tongue = 0; tongue < TONGUES; tongue += 1) {
    const baseX = Math.round((pixelHash(tongue, 0, seed, 1) - 0.5) * (TILE_WIDTH - 4));
    const baseY = -Math.round(pixelHash(tongue, 0, seed, 2) * (TILE_DEPTH - 3));
    const wander = valueNoise3(tongue * 3.1, seed * 0.01, elapsedMs / 170, seed);
    const height = Math.max(2, Math.round((3 + wander * 7) * strength));
    const width = 1 + Math.round(pixelHash(tongue, 0, seed, 3) * 2);
    pushTongue(cloud, { x: baseX, y: baseY, height, width, seed: seed + tongue, elapsedMs });
  }
  return cloud;
}

interface Tongue {
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly width: number;
  readonly seed: number;
  readonly elapsedMs: number;
}

function pushTongue(cloud: PixelCloud, tongue: Tongue): void {
  for (let up = 0; up < tongue.height; up += 1) {
    const rise = up / tongue.height;
    // A teardrop: swelling just above the root, then drawing to a point.
    const swell = rise < 0.3 ? 0.75 + rise : 1;
    const half = Math.max(0, Math.round(tongue.width * swell * (1 - rise) ** 0.8));
    const sway = Math.round(valueNoise2(up * 0.4, tongue.elapsedMs / 110 + tongue.seed, tongue.seed) * 2 - 1);
    for (let dx = -half; dx <= half; dx += 1) {
      const x = tongue.x + dx + (rise > 0.5 ? sway : 0);
      const y = tongue.y - up;
      // Tips tear off into separate licks: the top third thins by dither.
      if (rise > 0.66 && (rise - 0.66) * 3 > ditherThreshold(x, y + Math.floor(tongue.elapsedMs / 60))) {
        continue;
      }
      const edge = half === 0 ? 0 : Math.abs(dx) / (half + 1);
      cloud.push({ x, y, ink: rampInk(FLAME, 1 - rise * 0.8 - edge * 0.35, { x, y }) });
    }
  }
}

/**
 * The scar on a cell: charred ground in a ragged patch covering the tile, with
 * embers that glow and wink out while it is fresh. Top-left anchored on the
 * tile, `TILE_WIDTH` × `TILE_DEPTH`. `scorch` 1 is fresh, fading to 0 as the
 * grass returns; `heat` 0..1 is how many embers still glow.
 */
export function scorchCloud(seed: number, scorch: number, heat: number, elapsedMs: number): PixelCloud {
  const cloud: PixelCloud = [];
  for (let y = 0; y < TILE_DEPTH; y += 1) {
    for (let x = 0; x < TILE_WIDTH; x += 1) {
      // Soft, ragged edges so neighbouring scars join into one burn.
      const edge = Math.min(x + 1, TILE_WIDTH - x, y + 1, TILE_DEPTH - y) / 3;
      const cover = Math.min(1, edge) * 0.55 + valueNoise2(x / 3, y / 3, seed) * 0.6;
      if (cover * scorch < 0.35 + ditherThreshold(x, y) * 0.3) {
        continue;
      }
      const glow = heat > 0 && pixelHash(x, y, seed, Math.floor(elapsedMs / 400)) < heat * 0.08;
      const ink = glow
        ? rampInk(EMBERS, pixelHash(x, y, seed, 5), { x, y })
        : rampInk(CHAR, valueNoise2(x / 2, y / 2, seed + 7), { x, y });
      cloud.push({ x, y, ink });
    }
  }
  return cloud;
}
