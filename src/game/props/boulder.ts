/**
 * A boulder: the chestnut's body, with stone lobes and a stone ramp.
 *
 * Worth reading beside `trees/sdf-crown.ts`, because the point of this file is
 * how little of it there is. The lobes are squat instead of a ring, the ramp is
 * `bone` instead of `canopy`, the warp is small and *still* instead of large
 * and drifting — and that is the entire difference between a tree crown and a
 * rock. Everything that makes either read as a solid lit object comes from
 * `procgen/volume.ts`.
 *
 * A rock is also the cheapest possible test of whether the body generalises,
 * because it has no animation to hide behind. If the light model is wrong, a
 * boulder looks wrong immediately and in every frame.
 *
 * The one thing it adds is the moss: a second, smaller body unioned on top,
 * inked from the canopy ramp and biased to the lit side. That is the pattern
 * for any surface growth — barnacles, rust, snow drift, fungus — and it is a
 * second `volumeCloud` call, not a texture.
 */

import type { PixelCloud } from "../ink";
import {
  detailOf,
  type SceneryEnv,
  type SceneryInstance,
  type ScenerySpecies,
  type VolumePart,
} from "../scenery";
import { lobeMound, volumeCloud, type Lobe } from "../procgen/volume";
import { INK_RAMPS } from "../shading";
import { pixelHash } from "../transforms";

const WIDTH = 26;
const HEIGHT = 17;

class Boulder implements SceneryInstance {
  private readonly body: readonly Lobe[];
  private readonly moss: readonly Lobe[];

  constructor(private readonly seed: number) {
    this.body = lobeMound(3 + Math.floor(pixelHash(0, 0, seed, 1) * 2), WIDTH, HEIGHT, seed);
    // Moss sits on the shoulders, never on the flank: a patch that wraps under
    // the rock reads as a stain rather than as something growing on it.
    this.moss = this.body
      .filter((_lobe, index) => pixelHash(index, 0, seed, 8) > 0.35)
      .map((lobe) => ({
        x: lobe.x - 1,
        y: lobe.y - lobe.radius * 0.55,
        radius: lobe.radius * 0.52,
      }));
  }

  /**
   * The boulder, described rather than drawn.
   *
   * `cloud` renders these on the CPU and the GPU renderer draws the very same
   * objects, so the two paths cannot disagree about where the rock is — only
   * about who evaluates its field.
   */
  volumes(env: SceneryEnv): readonly VolumePart[] {
    const detail = detailOf(env);
    const shading = {
      light: env.light,
      dither: detail.dither,
      normalEpsilon: detail.normalEpsilon,
      flat: detail.flat,
    };
    const parts: VolumePart[] = [
      {
        spec: {
          lobes: this.body,
          weld: 1.8,
          // A still warp: rock is lumpy but it does not breathe. Same mechanism
          // as the canopy's, with the drift held at a constant.
          warp: {
            amplitudeX: 2.6,
            amplitudeY: 2,
            scale: 4,
            seed: this.seed,
            drift: 0,
            octaves: detail.warpOctaves,
          },
        },
        light: { ramp: INK_RAMPS.bone, ambient: 0.1, occlusion: 0.16, ...shading },
        clip: { bottom: 0 },
      },
    ];
    if (this.moss.length > 0 && detail.tier !== "far") {
      parts.push({
        spec: {
          lobes: this.moss,
          weld: 1.4,
          warp: { amplitudeX: 3.2, amplitudeY: 2.4, scale: 3, seed: this.seed + 5, drift: 0, octaves: 1 },
        },
        light: { ramp: INK_RAMPS.canopy, ambient: 0.2, occlusion: 0.3, ...shading },
        clip: { bottom: -2 },
      });
    }
    return parts;
  }

  cloud(env: SceneryEnv): PixelCloud {
    const cloud: PixelCloud = [];
    for (const part of this.volumes(env)) {
      for (const pixel of volumeCloud(part.spec, part.light, part.clip)) {
        cloud.push(pixel);
      }
    }
    return cloud;
  }
}

export const BOULDER: ScenerySpecies = {
  id: "boulder",
  kind: "prop",
  label: "Boulder — SDF body, mossed",
  technique: "the chestnut's volume with stone lobes, a still warp and a second body for moss",
  notes:
    "The same procgen/volume.ts the chestnut crown is made of: squat lobes instead of a ring, the " +
    "bone ramp instead of canopy, and a warp whose drift is held still because rock does not " +
    "breathe. The moss is a second, smaller volume unioned on the shoulders — the pattern for any " +
    "surface growth, from rust to snow drift. No animation to hide behind, so it is the honest " +
    "test of whether the light model works.",
  footprint: { width: 44, height: 30, originX: 22, originY: 26 },
  create: (seed) => new Boulder(seed),
};
