/**
 * The scenery catalogue, and the one place a body is *staged*.
 *
 * Staging is the shared half of drawing any of them: the cast shadow beneath,
 * the body itself, and — where it stands in water — its reflection. No species
 * knows about any of that, which is the point. A species answers "what shape am
 * I now"; the stage answers "what does that look like standing here, lit from
 * there, in this weather".
 *
 * `sampleSpeciesFrames` is the bridge to the asset lab: it drives a species
 * through fixed 16 ms slices so a stateful one (the willow's ropes, the birch's
 * fire, the poplar's leaves) bakes to the same filmstrip on every run.
 */

import { cloudToSprite, type PixelCloud } from "../ink";
import { DETAIL_TIERS } from "../lod";
import type { PixelSpriteSource } from "../pixel-art";
import { PROP_SPECIES } from "../props";
import {
  DEFAULT_SCENERY_ENV,
  type SceneryEnv,
  type SceneryInstance,
  type ScenerySpecies,
} from "../scenery";
import { reflectCloud } from "../transforms";
import { COLONIZED_ASH } from "./colonized-ash";
import { EMBER_BIRCH } from "./ember-birch";
import { castShadow } from "./foliage";
import { LEAF_SWARM } from "./leaf-swarm";
import { NOISE_CANOPY } from "./noise-canopy";
import { OAK_RECURSIVE } from "./oak-recursive";
import { SDF_CROWN } from "./sdf-crown";
import { SNOW_CONIFER } from "./snow-conifer";
import { WILLOW_VERLET } from "./willow-verlet";

export const TREE_SPECIES: readonly ScenerySpecies[] = [
  OAK_RECURSIVE,
  WILLOW_VERLET,
  NOISE_CANOPY,
  SDF_CROWN,
  COLONIZED_ASH,
  EMBER_BIRCH,
  LEAF_SWARM,
  SNOW_CONIFER,
];

/** Everything that stands in the field: trees first, then props. */
export const SCENERY_SPECIES: readonly ScenerySpecies[] = [...TREE_SPECIES, ...PROP_SPECIES];

export function findSpecies(id: string): ScenerySpecies | undefined {
  return SCENERY_SPECIES.find((species) => species.id === id);
}

export interface StageOptions {
  /** Cast the body's silhouette onto the ground as `void` pixels. */
  readonly shadow?: boolean;
  /** Sun height: 1 is noon, 0.2 rakes the shadow across the field. */
  readonly elevation?: number;
  /** Mirror the body below its foot, as standing water would. */
  readonly reflection?: boolean;
  /**
   * How many rows of water there are to reflect *into*.
   *
   * Without it a 45px tree mirrors 25px down and the far end of the reflection
   * lands on dry ground, where it reads as scattered litter rather than as
   * something in the water. A reflection is bounded by its pool.
   */
  readonly reflectionDepth?: number;
}

/**
 * Shadow, body, reflection — in that painter's order, so the trunk covers its
 * own contact shadow and the reflection sits under both.
 */
export function stageTree(
  instance: SceneryInstance,
  env: SceneryEnv,
  options: StageOptions = {},
): PixelCloud {
  const tree = instance.cloud(env);
  const staged: PixelCloud = [];

  if (options.shadow ?? true) {
    for (const pixel of castShadow(tree, { light: env.light, elevation: options.elevation ?? 0.55 })) {
      staged.push(pixel);
    }
  }
  if (options.reflection === true) {
    // Water reflects what is lit, interlaced so the surface reads as moving.
    const depth = options.reflectionDepth ?? Number.POSITIVE_INFINITY;
    for (const pixel of reflectCloud(tree, { squash: 0.55, interlace: 2, ink: null })) {
      if (pixel.y <= depth) {
        staged.push(pixel);
      }
    }
  }
  for (const pixel of tree) {
    staged.push(pixel);
  }
  return staged;
}

/** One fixed simulation slice, matched to the Verlet and sway integrators. */
const BAKE_STEP_MS = 16;

/**
 * Bake a species to a filmstrip by driving it in fixed slices.
 *
 * Stepping rather than sampling matters: several species integrate, and asking
 * one of those for its cloud at t=3000 without having run it there would give a
 * body that has never felt a gust.
 *
 * Baked at `near` detail always. A filmstrip is inspected at 6x in the asset
 * lab, which is the one place the distance budget must not apply.
 */
export function sampleSpeciesFrames(
  species: ScenerySpecies,
  count: number,
  seed: number,
  spanMs = 6000,
): readonly PixelSpriteSource[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Species frame count must be a positive integer");
  }
  const instance = species.create(seed);
  const frames: PixelSpriteSource[] = [];
  let elapsed = 0;
  for (let index = 0; index < count; index += 1) {
    const until = (index / count) * spanMs;
    while (elapsed < until) {
      elapsed = Math.min(elapsed + BAKE_STEP_MS, until);
      instance.step?.(BAKE_STEP_MS, bakeEnv(elapsed));
    }
    frames.push(
      cloudToSprite(stageTree(instance, bakeEnv(elapsed), { shadow: false }), species.footprint),
    );
  }
  return frames;
}

function bakeEnv(elapsedMs: number): SceneryEnv {
  return { ...DEFAULT_SCENERY_ENV, elapsedMs, detail: DETAIL_TIERS.near };
}

export type { SceneryEnv, SceneryInstance, ScenerySpecies } from "../scenery";
export { DEFAULT_SCENERY_ENV } from "../scenery";
