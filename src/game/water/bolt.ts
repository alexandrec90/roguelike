/**
 * A lightning strike as pixels: a white-hot core, a violet glow, and branches.
 *
 * The trunk is `lightningBolt`'s seeded polyline, unchanged — the schedule and
 * the shape of a strike were right; what was wrong was drawing it as a line of
 * one ink. A strike reads as *light* when it has three things a line does not:
 *
 * - a **core** in the near-white `foam`, one pixel wide;
 * - a **glow** of `arcane` violet hugging it, dithered away from the core so it
 *   is a halo rather than a thicker line;
 * - **branches** — the same seeded polyline again from a few points on the
 *   trunk, leaning away from it, shorter and dimmer, and at most one level
 *   deep, because a bolt with sub-sub-branches at 320x180 is a scribble.
 *
 * Pure: `(seed, geometry, intensity)` in, a cloud out, so a strike captured at
 * a fixed time is the same strike every run.
 */

import type { InkId, PixelCloud } from "../ink";
import { ditherThreshold } from "../shading";
import { pixelHash } from "../transforms";
import { lightningBolt, type BoltPoint } from "../weather";

export const BOLT_CORE: InkId = "foam";
export const BOLT_GLOW: InkId = "arcane-4";
export const BOLT_HALO: InkId = "arcane-3";

/** How many branches a trunk may throw. */
const MAX_BRANCHES = 4;

/** Rasterise a polyline to its pixel run, top to bottom, without repeats. */
function trace(points: readonly BoltPoint[]): { x: number; y: number }[] {
  const run: { x: number; y: number }[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1] as BoltPoint;
    const to = points[index] as BoltPoint;
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1);
    for (let step = index === 1 ? 0 : 1; step <= steps; step += 1) {
      run.push({
        x: Math.round(from.x + ((to.x - from.x) * step) / steps),
        y: Math.round(from.y + ((to.y - from.y) * step) / steps),
      });
    }
  }
  return run;
}

/**
 * Glow on either side of a run of core pixels. `strength` 0..1 thins it
 * through the dither, so a fading strike loses its halo before its core.
 */
function glow(cloud: PixelCloud, run: readonly { x: number; y: number }[], strength: number): void {
  for (const { x, y } of run) {
    for (const dx of [-1, 1]) {
      if (strength * 0.6 > ditherThreshold(x + dx, y)) {
        cloud.push({ x: x + dx, y, ink: BOLT_GLOW });
      } else if (strength * 0.9 > ditherThreshold(x + dx, y)) {
        cloud.push({ x: x + dx, y, ink: BOLT_HALO });
      }
      if (strength * 0.18 > ditherThreshold(x + dx * 2, y)) {
        cloud.push({ x: x + dx * 2, y, ink: BOLT_HALO });
      }
    }
  }
}

/** A branch: the same seeded walk from a trunk point, leaning off to one side. */
function branch(seed: number, from: BoltPoint, length: number, lean: number): { x: number; y: number }[] {
  const points = lightningBolt(seed, from.x, from.y, from.y + length).map((point) => ({
    x: point.x + Math.round((point.y - from.y) * lean),
    y: point.y,
  }));
  return trace(points);
}

/**
 * The whole strike from `topY` down to `bottomY` at column `x`.
 *
 * `intensity` 0..1 is the flash's current brightness: the glow and the
 * branches read it, the core does not — the channel stays white-hot for as
 * long as the strike is on screen at all.
 */
export function boltCloud(
  seed: number,
  x: number,
  topY: number,
  bottomY: number,
  intensity = 1,
): PixelCloud {
  const trunkPoints = lightningBolt(seed, x, topY, bottomY);
  const trunk = trace(trunkPoints);
  const cloud: PixelCloud = [];
  const span = bottomY - topY;
  const branches: { x: number; y: number }[][] = [];

  const count = 1 + Math.floor(pixelHash(seed, 0, 0xb017) * MAX_BRANCHES);
  for (let index = 0; index < count; index += 1) {
    const at = trunkPoints[1 + Math.floor(pixelHash(seed, index + 1, 0xb017) * (trunkPoints.length * 0.7))];
    if (at === undefined) {
      continue;
    }
    const side = pixelHash(seed, index + 11, 0xb017) < 0.5 ? -1 : 1;
    const lean = side * (0.6 + pixelHash(seed, index + 21, 0xb017) * 0.9);
    const length = Math.max(3, Math.round(span * (0.2 + pixelHash(seed, index + 31, 0xb017) * 0.3)));
    branches.push(branch(seed ^ (0x9e37 * (index + 1)), at, length, lean));
  }

  const level = Math.min(Math.max(intensity, 0), 1);
  glow(cloud, trunk, level);
  for (const run of branches) {
    // Branches are one pixel wide, white where they leave the trunk and cooling
    // to violet toward their tips — the fading strike loses its tips first.
    run.forEach((pixel, index) => {
      const tip = index / Math.max(run.length - 1, 1);
      if (tip > 0.35 + level * 0.65) {
        return;
      }
      cloud.push({ ...pixel, ink: tip < 0.2 * level ? BOLT_CORE : tip < 0.6 ? BOLT_GLOW : BOLT_HALO });
    });
  }
  for (const pixel of trunk) {
    cloud.push({ ...pixel, ink: BOLT_CORE });
  }
  return cloud;
}
