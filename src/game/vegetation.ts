/**
 * Seeded vegetation animated by one coherent wind field.
 *
 * These are models, not frame drawings: grass blades and tree branches are
 * regenerated from their anchors for any elapsed time. Roots never move,
 * while displacement increases with height, so a gust bends a silhouette
 * instead of sliding it across the ground.
 */

import { cloudToSprite, strokeLine, type InkId, type PixelCloud } from "./ink";
import type { PixelSpriteSource } from "./pixel-art";
import { pixelHash } from "./transforms";

const TAU = Math.PI * 2;
export const WIND_PERIOD_MS = 4800;
export const VEGETATION_WIND_SEED = 0x51a7;

/** A looping, integer-pixel wind sample with spatially coherent phase. */
export function windOffset(
  elapsedMs: number,
  seed: number,
  x = 0,
  y = 0,
  strength = 2,
): number {
  if (!Number.isFinite(strength) || strength < 0) {
    throw new Error("Wind strength must be a non-negative number");
  }
  const phase = pixelHash(0, 0, seed) * TAU + x * 0.035 + y * 0.021;
  const angle = (elapsedMs / WIND_PERIOD_MS) * TAU + phase;
  const wave = (Math.sin(angle) + 0.35 * Math.sin(angle * 2 + 0.7)) / 1.35;
  return Math.round(wave * strength);
}

function tuftLayout(seed: number): readonly { rootX: number; height: number }[] {
  return Array.from({ length: 5 }, (_, index) => ({
    rootX: Math.round(-7 + pixelHash(index, 0, seed, 1) * 14),
    height: 2 + Math.floor(pixelHash(index, 0, seed, 2) * 4),
  }));
}

/** Five authored-by-rule blades sharing the field's wind but not its phase. */
export function grassTuftCloud(elapsedMs: number, seed: number, fieldX = 0, fieldY = 0): PixelCloud {
  const cloud: PixelCloud = [];
  for (const [index, blade] of tuftLayout(seed).entries()) {
    const bend = windOffset(
      elapsedMs,
      VEGETATION_WIND_SEED,
      fieldX + blade.rootX * 3,
      fieldY + index * 5,
      2,
    );
    const tip = { x: blade.rootX + bend, y: -blade.height };
    strokeLine(cloud, { x: blade.rootX, y: 0 }, tip, "deep");
    cloud.push({ ...tip, ink: "neon-green" });
  }
  return cloud;
}

interface Branch {
  readonly y: number;
  readonly side: -1 | 1;
  readonly length: number;
  readonly rise: number;
  readonly crown: number;
}

const BRANCHES: readonly Branch[] = [
  { y: -10, side: -1, length: 7, rise: 3, crown: 0 },
  { y: -13, side: 1, length: 8, rise: 4, crown: 1 },
  { y: -17, side: -1, length: 9, rise: 4, crown: 2 },
  { y: -20, side: 1, length: 7, rise: 5, crown: 3 },
];

function trunkX(y: number, middleSway: number, crownSway: number): number {
  const height = Math.min(Math.max(-y / 28, 0), 1);
  return Math.round(middleSway * height * (1 - height) + crownSway * height * height);
}

interface FoliageCluster {
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly seed: number;
  readonly salt: number;
}

function foliageCluster(cloud: PixelCloud, cluster: FoliageCluster): void {
  for (let y = -cluster.radiusY; y <= cluster.radiusY; y += 1) {
    for (let x = -cluster.radiusX; x <= cluster.radiusX; x += 1) {
      const distance =
        (x * x) / (cluster.radiusX * cluster.radiusX) +
        (y * y) / (cluster.radiusY * cluster.radiusY);
      const ragged = pixelHash(x, y, cluster.seed, cluster.salt) * 0.28;
      if (distance > 1.08 - ragged) {
        continue;
      }
      const edge =
        distance > 0.58 && pixelHash(x, y, cluster.seed, cluster.salt + 20) > 0.38;
      const ink: InkId = edge ? "neon-green" : "deep";
      cloud.push({ x: cluster.x + x, y: cluster.y + y, ink });
    }
  }
}

/** A rooted broadleaf skeleton with branches and foliage deformed by height. */
export function treeCloud(elapsedMs: number, seed: number, fieldX = 0, fieldY = 0): PixelCloud {
  const cloud: PixelCloud = [];
  const middleSway = windOffset(
    elapsedMs,
    VEGETATION_WIND_SEED,
    fieldX + 5,
    fieldY - 12,
    2,
  );
  const crownSway = windOffset(
    elapsedMs,
    VEGETATION_WIND_SEED,
    fieldX + 9,
    fieldY - 28,
    3,
  );
  const lower = { x: 0, y: -8 };
  const middle = { x: trunkX(-17, middleSway, crownSway), y: -17 };
  const crown = { x: trunkX(-28, middleSway, crownSway), y: -28 };

  // The even-width brush extends toward positive y, so start one pixel above
  // the foot and stamp roots separately; no trunk pixel may sink below y=0.
  strokeLine(cloud, { x: 0, y: -1 }, lower, "deep", 2);
  strokeLine(cloud, lower, middle, "steel", 2);
  strokeLine(cloud, middle, crown, "steel");
  strokeLine(cloud, { x: -4, y: 0 }, { x: 4, y: 0 }, "deep");

  for (const branch of BRANCHES) {
    const startX = trunkX(branch.y, middleSway, crownSway);
    const heightWeight = -branch.y / 28;
    const end = {
      x:
        startX +
        branch.side * branch.length +
        Math.round(crownSway * heightWeight * 0.55),
      y: branch.y - branch.rise,
    };
    strokeLine(cloud, { x: startX, y: branch.y }, end, "steel");
    foliageCluster(cloud, {
      x: end.x,
      y: end.y,
      radiusX: 5,
      radiusY: 3,
      seed,
      salt: branch.crown,
    });
  }

  foliageCluster(cloud, {
    x: crown.x - 4,
    y: crown.y + 2,
    radiusX: 5,
    radiusY: 4,
    seed,
    salt: 8,
  });
  foliageCluster(cloud, {
    x: crown.x + 3,
    y: crown.y,
    radiusX: 5,
    radiusY: 4,
    seed,
    salt: 9,
  });
  return cloud;
}

/** A six-pixel horizon silhouette bent from its rooted base. */
export function distantPineCloud(elapsedMs: number, seed: number, fieldX = 0): PixelCloud {
  const cloud: PixelCloud = [];
  const sway = windOffset(elapsedMs, VEGETATION_WIND_SEED, fieldX, -5, 1);
  strokeLine(cloud, { x: 0, y: 0 }, { x: sway, y: -5 }, "deep");
  for (let y = -4; y <= -2; y += 1) {
    const height = -y;
    const center = Math.round((sway * height) / 5);
    const halfWidth = 5 - height;
    strokeLine(cloud, { x: center - halfWidth, y }, { x: center + halfWidth, y }, "deep");
  }
  return cloud;
}

function sampleFrames(
  count: number,
  draw: (elapsedMs: number) => PixelCloud,
  frame: { width: number; height: number; originX: number; originY: number },
): readonly PixelSpriteSource[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Vegetation frame count must be a positive integer");
  }
  return Array.from({ length: count }, (_, index) =>
    cloudToSprite(draw((index / count) * WIND_PERIOD_MS), frame),
  );
}

export function sampleGrassFrames(count = 8, seed = 0x6a55): readonly PixelSpriteSource[] {
  return sampleFrames(count, (elapsedMs) => grassTuftCloud(elapsedMs, seed), {
    width: 18,
    height: 7,
    originX: 9,
    originY: 6,
  });
}

export function sampleTreeFrames(count = 8, seed = 0x7e31): readonly PixelSpriteSource[] {
  return sampleFrames(count, (elapsedMs) => treeCloud(elapsedMs, seed), {
    width: 34,
    height: 34,
    originX: 17,
    originY: 33,
  });
}

export function sampleDistantPineFrames(count = 8, seed = 0x413e): readonly PixelSpriteSource[] {
  return sampleFrames(count, (elapsedMs) => distantPineCloud(elapsedMs, seed), {
    width: 7,
    height: 6,
    originX: 3,
    originY: 5,
  });
}
