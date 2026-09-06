/**
 * Species 4 — the chestnut: a **volumetric SDF body**, lit by its own gradient.
 *
 * The crown is five circles smooth-unioned into one field and domain-warped by
 * noise, so the surface is lumpy and leafy and *breathes* as the warp animates.
 * Every pixel is lit from the field's gradient — a real surface normal — and
 * darkened by how deep inside the mass it sits, which is ambient occlusion for
 * nothing. Change the light direction and the whole canopy re-lights correctly,
 * which no drawn frame and no flat threshold field can do.
 *
 * The mechanism itself now lives in `procgen/volume.ts`, because it turned out
 * not to be about trees at all: `props/` builds a boulder, a bush and a
 * mushroom out of the same three calls. This file is what makes that body a
 * *chestnut* — where its lobes sit, what ramp it wears, and the spring that
 * leans it into the wind.
 *
 * It is also the species that honours the detail budget most, being the most
 * expensive: at distance it drops the warp's second octave, blunts the normal,
 * and finally stops computing a normal at all — four fifths of the render, for
 * a rim highlight nobody can see from there. Every tier evaluates the same
 * field, so a chestnut rolling in over the horizon gains detail rather than
 * being swapped for a different tree.
 */

import type { PixelCloud } from "../ink";
import { cachedPose, createPoseCache, quantize, type Detail, type PoseCache } from "../lod";
import { lobeRing, volumeCloud, type Lobe, type VolumeSpec } from "../procgen/volume";
import {
  detailOf,
  type SceneryEnv,
  type SceneryInstance,
  type ScenerySpecies,
  type VolumePart,
} from "../scenery";
import { INK_RAMPS } from "../shading";
import { createSway, stepSway, windAt, type Sway } from "../wind";
import { rooted } from "./foliage";

const CROWN_Y = -29;

class SdfCrown implements SceneryInstance {
  private readonly crown: readonly Lobe[];
  private readonly sway: Sway;
  private readonly cache: PoseCache<PixelCloud> = createPoseCache(16);
  private lean = 0;

  constructor(private readonly seed: number) {
    this.crown = lobeRing(5, { x: 0, y: CROWN_Y, radiusX: 9, radiusY: 6 }, { min: 6.5, max: 10 }, seed);
    this.sway = createSway({ frequency: 0.38, damping: 0.3, response: 3.4 });
  }

  step(dtMs: number, env: SceneryEnv): void {
    this.lean = stepSway(
      this.sway,
      dtMs,
      windAt(env.elapsedMs, env.fieldX, env.fieldY + CROWN_Y, env.wind),
    );
  }

  /** The pose the body is actually drawn at, snapped to the detail's quantum. */
  private pose(env: SceneryEnv): { lean: number; drift: number; detail: Detail } {
    const detail = detailOf(env);
    return {
      detail,
      lean: quantize(this.lean, detail.poseQuantum),
      drift: quantize(env.elapsedMs / 1500, detail.poseQuantum * 0.25),
    };
  }

  cloud(env: SceneryEnv): PixelCloud {
    // The render is snapped to whole pixels anyway, so snapping the *inputs* to
    // a quantum and caching the result is exact up to that quantum: every frame
    // between two distinct poses becomes a cache hit that draws exactly the
    // pixels a full rasterisation would have spent its time computing.
    const { lean, drift, detail } = this.pose(env);
    const light = `${Math.round(env.light.x * 8)},${Math.round(env.light.y * 8)}`;
    return cachedPose(this.cache, `${lean}|${drift}|${detail.tier}|${light}`, () => {
      const cloud: PixelCloud = [];
      for (const part of this.parts(lean, drift, env, detail)) {
        for (const pixel of volumeCloud(part.spec, part.light, part.clip)) {
          cloud.push(pixel);
        }
      }
      return rooted(cloud);
    });
  }

  volumes(env: SceneryEnv): readonly VolumePart[] {
    const { lean, drift, detail } = this.pose(env);
    return this.parts(lean, drift, env, detail);
  }

  /**
   * Trunk and canopy, as two bodies rather than one.
   *
   * Two rather than a single union because the two want different ramps: welded
   * into one field, the trunk would be lit from the canopy's greens. The trunk's
   * lobes are **capsules** — the same primitive as the discs above them — which
   * is what lets the whole tree be one description the GPU can draw, instead of
   * a volume with some line art beside it.
   */
  private parts(lean: number, drift: number, env: SceneryEnv, detail: Detail): VolumePart[] {
    const shading = {
      light: env.light,
      dither: detail.dither,
      normalEpsilon: detail.normalEpsilon,
      flat: detail.flat,
    };
    return [
      {
        spec: {
          weld: 1.1,
          lobes: [
            { x: 0, y: 0, toX: lean * 0.5, toY: CROWN_Y + 9, radius: 2.1 },
            { x: lean * 0.5, y: CROWN_Y + 9, toX: lean - 7, toY: CROWN_Y + 1, radius: 1.3 },
            { x: lean * 0.5, y: CROWN_Y + 9, toX: lean + 8, toY: CROWN_Y + 2, radius: 1.3 },
          ],
        },
        light: { ramp: INK_RAMPS.bone, ambient: 0.2, occlusion: 0.22, ...shading },
        clip: { bottom: 0 },
      },
      {
        spec: this.canopySpec(lean, drift, detail.warpOctaves),
        light: { ramp: INK_RAMPS.canopy, ambient: 0.04, occlusion: 0.13, ...shading },
        clip: { bottom: 0 },
      },
    ];
  }

  /**
   * The warp amplitude decides whether this reads as foliage or as bubblegum:
   * under about 1.5 logical pixels it is a smooth blob, over about 4 it
   * dissolves into clumps that no longer share a silhouette.
   */
  private canopySpec(lean: number, drift: number, octaves: number): VolumeSpec {
    return {
      lobes: this.crown.map((lobe) => ({ ...lobe, x: lobe.x + lean * 1.2 })),
      weld: 2.6,
      warp: {
        amplitudeX: 5.4,
        amplitudeY: 4.2,
        scale: 5,
        seed: this.seed,
        drift: drift + lean * 0.6,
        octaves,
      },
    };
  }
}

export const SDF_CROWN: ScenerySpecies = {
  id: "sdf-crown",
  kind: "tree",
  label: "Chestnut — SDF crown, per-pixel lit",
  technique: "smooth-union SDF + animated domain warp, shaded from the field gradient",
  notes:
    "Five circles welded by a smooth union, then domain-warped by fBm so the surface is leafy and " +
    "breathing. Every pixel is lit from the field's own gradient — a real normal — and darkened by " +
    "how deep inside the mass it sits, which is ambient occlusion for free. Change the light " +
    "direction and the whole canopy re-lights correctly. The body is procgen/volume.ts, shared " +
    "with the boulder, the bush and the mushroom.",
  footprint: { width: 74, height: 58, originX: 37, originY: 57 },
  create: (seed) => new SdfCrown(seed),
};
