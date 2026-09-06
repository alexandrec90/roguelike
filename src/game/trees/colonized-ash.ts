/**
 * Species 5 — **space colonization**: the branch structure is grown, not ruled.
 *
 * Attractor points are scattered through a crown envelope and the branches race
 * each other to reach them (`procgen/growth.ts`). Because branches consume the
 * attractors they arrive at, they compete: the structure forks where there is
 * unclaimed volume, thins where a neighbour got there first, and never grows
 * two limbs into the same space. Limb thickness then falls out of the da Vinci
 * rule, so the taper is a consequence of how much crown a limb is feeding.
 *
 * Set against the fractal of species 1, the difference is *individuality*. A
 * fractal at two seeds gives the same tree twice with the angles jittered; this
 * gives two trees that grew in different places. That matters most for a forest
 * — twelve of these read as twelve trees, twelve fractals read as wallpaper.
 *
 * The wind is applied to the finished skeleton as a cantilever bend: sideways
 * displacement rises with the square-ish of height, which is how an actual beam
 * deflects, so the foot stays planted while the crown travels.
 */

import { strokeLine, type PixelCloud } from "../ink";
import { growSkeleton, limbTips, type Limb } from "../procgen/growth";
import { INK_RAMPS } from "../shading";
import { createSway, stepSway, windAt, type Sway } from "../wind";
import { barkInk, leafCluster, rooted } from "./foliage";
import type { SceneryEnv, SceneryInstance, ScenerySpecies } from "../scenery";

const CROWN_TOP = -40;

class ColonizedAsh implements SceneryInstance {
  private readonly limbs: readonly Limb[];
  private readonly tips: readonly Limb[];
  private readonly trunkSway: Sway;
  private readonly twigSway: Sway;
  private bend = 0;
  private twigBend = 0;

  constructor(private readonly seed: number) {
    this.limbs = growSkeleton({
      seed,
      crownY: -30,
      crownRadiusX: 16,
      crownRadiusY: 11,
      attractors: 170,
      attractionRadius: 12,
      killRadius: 2.2,
      stepLength: 2,
      maxLimbs: 240,
      tropism: 0.3,
    });
    this.tips = limbTips(this.limbs);
    this.trunkSway = createSway({ frequency: 0.36, damping: 0.32, response: 4.6 });
    this.twigSway = createSway({ frequency: 0.95, damping: 0.16, response: 2.2 });
  }

  step(dtMs: number, env: SceneryEnv): void {
    const drive = windAt(env.elapsedMs, env.fieldX, env.fieldY - 20, env.wind);
    this.bend = stepSway(this.trunkSway, dtMs, drive);
    this.twigBend = stepSway(this.twigSway, dtMs, drive);
  }

  /** Cantilever deflection: a beam's tip moves as height to a power near 2. */
  private bentX(limb: Limb): number {
    const height = Math.min(-limb.y / -CROWN_TOP, 1);
    return limb.x + this.bend * height ** 1.8 + this.twigBend * height ** 3.4;
  }

  cloud(env: SceneryEnv): PixelCloud {
    const cloud: PixelCloud = [];
    const wood: PixelCloud = [];
    for (const limb of this.limbs) {
      const parent = limb.parent < 0 ? undefined : this.limbs[limb.parent];
      if (parent === undefined) {
        continue;
      }
      strokeLine(
        wood,
        { x: Math.round(this.bentX(parent)), y: Math.round(parent.y) },
        { x: Math.round(this.bentX(limb)), y: Math.round(limb.y) },
        "steel",
        limb.thickness > 1.6 ? 3 : limb.thickness > 0.9 ? 2 : 1,
      );
    }
    for (const pixel of wood) {
      cloud.push({ x: pixel.x, y: pixel.y, ink: barkInk(pixel.x, pixel.y, this.seed, INK_RAMPS.bone) });
    }

    this.tips.forEach((tip, index) => {
      leafCluster(cloud, {
        x: Math.round(this.bentX(tip)),
        y: Math.round(tip.y),
        radiusX: 3,
        radiusY: 2,
        seed: this.seed + index * 7,
        elapsedMs: env.elapsedMs,
        ramp: INK_RAMPS.canopy,
        drift: this.twigBend * 12,
      });
    });
    return rooted(cloud);
  }
}

export const COLONIZED_ASH: ScenerySpecies = {
  id: "colonized-ash",
  kind: "tree",
  label: "Ash — space colonization",
  technique: "attractor-driven growth + da Vinci taper + cantilever wind bend",
  notes:
    "Branches compete for scattered attractor points, so the structure is decided by the crown " +
    "envelope rather than by a recursion depth — two seeds are two different trees, not one tree " +
    "jittered. Limb thickness is the da Vinci rule (parent² = sum of children²), and the wind " +
    "deflects each limb by height^1.8 the way a beam actually bends.",
  footprint: { width: 78, height: 60, originX: 39, originY: 59 },
  create: (seed) => new ColonizedAsh(seed),
};
