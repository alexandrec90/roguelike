/**
 * Baking scenery: a species posed at a handful of leans, flattened to pixels once.
 *
 * The first in-game scenery drew every tree every frame through a per-body
 * shader — two quads per volume part, each re-uploading its lobes, ramp and
 * warp as uniforms sixty times a second. On an integrated GPU that was a third
 * of the frame for pictures that barely change. A tree's look is a function of
 * very few things — which species, which seed, how far the wind leans it, where
 * the light comes from — so it is cheaper by orders of magnitude to render each
 * combination once and then only *choose* between them.
 *
 * So a body is baked at `WIND_LEVELS` leans. Each lean is reached honestly: the
 * species is stepped under a wind held fixed at that value (`WindOptions.fixed`)
 * until its own springs, ropes or particles settle, and the cloud it then
 * returns is what that body looks like leaning that far. Nothing here knows how
 * any species sways; each one still moves by its own mechanism, and a willow
 * baked this way hangs its fronds exactly as the lab's live willow would.
 *
 * In the game, a body picks the baked lean nearest the travelling wind at its
 * planet point, so gusts still roll across a wood as a visible wave — the same
 * field the grass reads.
 *
 * Measured under Node on the dev machine, settle plus bake, per lean: chestnut
 * 7.9 ms, boulder 4.1, spruce 2.6, mushrooms 2.5, bush 1.8, beech 1.5, ash 1.4,
 * oak 1.1. Hence never on the frame: `scenery-baker.ts` runs them on workers.
 *
 * Pure and renderer-free; `scenery-cache.ts` owns the textures these become.
 */

import { cloudBounds, type InkId, type PixelCloud } from "./ink";
import { bakeCloud, type BakedCloud } from "./pixel-buffer";
import { volumeCloud } from "./procgen/volume";
import { DEFAULT_SCENERY_ENV, type SceneryEnv, type SceneryInstance } from "./scenery";
import { castShadow } from "./trees/foliage";
import { DETAIL_TIERS } from "./lod";
import type { WindOptions } from "./wind";

/** The leans every body is baked at, as signed wind values. */
export const WIND_LEVELS: readonly number[] = [-1.1, -0.7, -0.35, 0, 0.35, 0.7, 1.1];

/** Simulated time a species is given to settle at a new wind, ms. */
export const SETTLE_MS = 2200;

/** One simulation slice while settling — the springs' own step. */
const SETTLE_STEP_MS = 16;

/** Where the light comes from, as a bake sees it. */
export interface BakeLight {
  readonly light: { readonly x: number; readonly y: number };
  /** Sun height, 0.2 raking .. 1 overhead. Decides the shadow's length. */
  readonly elevation: number;
}

/** A pose flattened: the body, and the shadow it casts (none on the roll). */
export interface BakedPose {
  readonly body: BakedCloud;
  readonly shadow: BakedCloud | null;
}

/** How many angle steps a full turn of the light is quantised into. */
const LIGHT_STEPS = 20;

/**
 * The light, snapped to the steps bakes are made at.
 *
 * A bake is a few milliseconds per lean, so a body cannot be re-baked every
 * frame the sun moves; it is re-baked each time the sun crosses a step — every
 * eighteen degrees of its arc, which is a handful of times an evening.
 */
export function quantizeLight(light: { x: number; y: number }, elevation: number): BakeLight {
  const angle = Math.atan2(light.y, light.x);
  const step = Math.round((angle / (Math.PI * 2)) * LIGHT_STEPS);
  const snapped = (step / LIGHT_STEPS) * Math.PI * 2;
  return {
    light: { x: Math.cos(snapped), y: Math.sin(snapped) },
    elevation: Math.round(Math.min(Math.max(elevation, 0.2), 1) * 10) / 10,
  };
}

/** A stable string for a quantised light, for cache keys. */
export function lightKey(light: BakeLight): string {
  const step = Math.round((Math.atan2(light.light.y, light.light.x) / (Math.PI * 2)) * LIGHT_STEPS);
  return `${step}:${Math.round(light.elevation * 10)}`;
}

/** The wind level nearest a signed wind value. */
export function windLevelIndex(wind: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  WIND_LEVELS.forEach((level, index) => {
    const distance = Math.abs(level - wind);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

function bakeEnv(light: BakeLight, wind: WindOptions): SceneryEnv {
  return {
    ...DEFAULT_SCENERY_ENV,
    elapsedMs: 0,
    wind,
    light: light.light,
    detail: DETAIL_TIERS.near,
  };
}

/**
 * Step a body under a wind held at `wind` until it settles.
 *
 * The instance is reused between levels, so a species with state (ropes, a
 * leaf swarm) carries it across and the leans it passes through stay coherent.
 */
export function settleAt(
  instance: SceneryInstance,
  wind: number,
  light: BakeLight,
  ms: number = SETTLE_MS,
): void {
  if (instance.step === undefined) {
    return;
  }
  const env = bakeEnv(light, { strength: 1, gustiness: 0.6, fixed: wind });
  for (let elapsed = 0; elapsed < ms; elapsed += SETTLE_STEP_MS) {
    instance.step(SETTLE_STEP_MS, { ...env, elapsedMs: elapsed });
  }
}

/** The body as it stands now, and its shadow under `light`. */
export function bakePose(instance: SceneryInstance, light: BakeLight, wind = 0): BakedPose {
  const env = bakeEnv(light, { strength: 1, gustiness: 0.6, fixed: wind });
  const cloud = instance.cloud(env);
  const shadow = castShadow(cloud, { light: light.light, elevation: light.elevation });
  return {
    body: bakeCloud(outlineCloud(cloud, light.light)),
    shadow: shadow.length === 0 ? null : bakeCloud(shadow),
  };
}

/**
 * The body at a fraction of its size, for the horizon roll.
 *
 * A species made of volumes is re-sampled properly: the same field evaluated at
 * a wider spacing, so a speck on the horizon is the tree, not a shrunk picture
 * of it. A species that is not (rope, particles, line-drawn limbs) has no field
 * to re-sample, and gets its full-size cloud point-sampled instead — the one
 * place a picture is shrunk, confined to bodies a few pixels tall where the
 * difference cannot be seen.
 */
export function bakeScaled(instance: SceneryInstance, light: BakeLight, scale: number): BakedCloud {
  const [baked] = bakeLadder(instance, light, [scale]);
  if (baked === undefined) {
    throw new Error("bakeLadder returned nothing for one scale");
  }
  return baked;
}

/**
 * The body at every scale in `scales`, for the horizon roll - one bake per
 * scale, from one posing.
 *
 * The body is posed once and only re-sampled per scale: its volumes evaluated
 * at each spacing, or its full-size cloud point-sampled. Posing a recursive oak
 * is most of a bake, and a ladder asked for one scale at a time posed it forty
 * times over.
 *
 * Each rung is finished exactly as `bakePose` finishes the body - the particles
 * over it, then the outline round it - so a rung is the body at that size and
 * not a second picture of it. A tree walks off the roll onto the field by
 * swapping its last rung for its full-size bake, and every pixel the two did
 * not share was a shape change on that frame.
 */
export function bakeLadder(instance: SceneryInstance, light: BakeLight, scales: readonly number[]): BakedCloud[] {
  const env = bakeEnv(light, { strength: 1, gustiness: 0.6, fixed: 0 });
  const finish = (cloud: PixelCloud): BakedCloud => bakeCloud(outlineCloud(cloud, light.light));
  const parts = instance.volumes?.(env);
  if (parts !== undefined && parts.length > 0) {
    const overlay = instance.overlay?.(env) ?? [];
    return scales.map((scale) =>
      finish([
        ...parts.flatMap((part) => volumeCloud(part.spec, part.light, part.clip, scale)),
        ...pointSample(overlay, scale),
      ]),
    );
  }
  const cloud = instance.cloud(env);
  return scales.map((scale) => finish(pointSample(cloud, scale)));
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** The darkest step of an ink's own family: `leaf-3` outlines in `leaf-0`. */
function outlineInk(ink: InkId): InkId | null {
  const cut = ink.lastIndexOf("-");
  if (cut <= 0 || !/^\d+$/.test(ink.slice(cut + 1)) || ink.startsWith("petal") || ink.startsWith("shadow")) {
    return null;
  }
  return `${ink.slice(0, cut)}-0` as InkId;
}

/**
 * A selective outline: one pixel of each material's darkest step round the
 * silhouette, on every side but the one facing the light.
 *
 * Without it a green crown on a green meadow is the same value as the grass
 * and dissolves at 1×; with it the body separates from the field the way
 * painted pixel art does, and the lit rim — left open — still reads as light
 * catching an edge rather than as a drawn line.
 */
export function outlineCloud(cloud: PixelCloud, light: { readonly x: number; readonly y: number }): PixelCloud {
  const key = (x: number, y: number): number => (y + 4096) * 8192 + x + 4096;
  const occupied = new Set<number>();
  for (const pixel of cloud) {
    occupied.add(key(pixel.x, pixel.y));
  }
  const rim: PixelCloud = [];
  const placed = new Set<number>();
  for (const pixel of cloud) {
    const ink = outlineInk(pixel.ink);
    if (ink === null) {
      continue;
    }
    for (const [dx, dy] of NEIGHBOURS) {
      // Open toward the light: that edge is lit, not outlined.
      if (dx * light.x + dy * light.y > 0.55) {
        continue;
      }
      const x = pixel.x + dx;
      const y = pixel.y + dy;
      const at = key(x, y);
      if (y > 0 || occupied.has(at) || placed.has(at)) {
        continue;
      }
      placed.add(at);
      rim.push({ x, y, ink });
    }
  }
  return [...rim, ...cloud];
}

/**
 * Nearest-neighbour resample of a cloud about its foot. Each target pixel takes
 * the source pixel under its centre, so the result is never wider than
 * `scale` of the original and keeps its foot at (0, 0).
 */
export function pointSample(cloud: PixelCloud, scale: number): PixelCloud {
  if (scale >= 1) {
    return cloud;
  }
  const bounds = cloudBounds(cloud);
  if (bounds === null) {
    return [];
  }
  const lookup = new Map<number, PixelCloud[number]>();
  for (const pixel of cloud) {
    lookup.set((pixel.y + 4096) * 8192 + pixel.x + 4096, pixel);
  }
  const sampled: PixelCloud = [];
  const left = Math.floor(bounds.left * scale);
  const right = Math.ceil(bounds.right * scale);
  const top = Math.floor(bounds.top * scale);
  const bottom = Math.ceil(bounds.bottom * scale);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const source = lookup.get((Math.round(y / scale) + 4096) * 8192 + Math.round(x / scale) + 4096);
      if (source !== undefined) {
        sampled.push({ x, y, ink: source.ink });
      }
    }
  }
  return sampled;
}
