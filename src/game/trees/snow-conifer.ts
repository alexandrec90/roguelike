/**
 * Species 8 — layered SDF tiers, needled by noise, with **snow that
 * accumulates on the surfaces facing the sky**.
 *
 * The shape is five squashed ellipses smooth-unioned into a spire, sheared by
 * one spring so the whole tree leans as a unit — a conifer's trunk is stiff and
 * its motion is a single mode, unlike the broadleaves above, which move in
 * three or four.
 *
 * The technique worth taking from this one is the last step. Snow is not a
 * white sprite laid over the tree: it is a **material chosen per pixel from the
 * surface normal**. Where the field's gradient points up, the pixel is a place
 * snow can sit, and the deeper the weather's `snow` value the further down the
 * shoulders of each tier it creeps. Wind scours it back off. The same rule
 * would frost a roof, a rock, a corpse or a signpost, because all any of them
 * has to supply is a normal.
 *
 * The needles are the second half of the silhouette: a noise threshold applied
 * only within a couple of pixels of the surface, so the edge is spiky and the
 * interior stays solid.
 */

import type { InkId, PixelCloud } from "../ink";
import { fbm2 } from "../procgen/noise";
import { fieldNormal, sdEllipse, sdCapsule, sdSmoothUnion, warpField, type SdfField } from "../procgen/sdf";
import { INK_RAMPS, rampInk } from "../shading";
import { pixelHash } from "../transforms";
import { createSway, gustAt, stepSway, windAt, type Sway } from "../wind";
import { rooted } from "./foliage";
import type { SceneryEnv, SceneryInstance, ScenerySpecies } from "../scenery";

const TIERS = 5;
const APEX = -44;

class SnowConifer implements SceneryInstance {
  private readonly sway: Sway;
  private lean = 0;
  private settled = 0;

  constructor(private readonly seed: number) {
    // Stiff and heavily damped: a spruce does not ring, it leans and returns.
    this.sway = createSway({ frequency: 0.48, damping: 0.5, response: 2.6 });
  }

  step(dtMs: number, env: SceneryEnv): void {
    this.lean = stepSway(this.sway, dtMs, windAt(env.elapsedMs, env.fieldX, env.fieldY - 24, env.wind));
    // Snow settles slowly and is scoured off fast, so the depth lags the
    // weather rather than tracking it — which is what makes a squall visible.
    const falling = env.weather?.snow ?? 0;
    const scour = gustAt(env.elapsedMs, env.wind) * 0.00035;
    const target = Math.max(0, falling - scour * 900);
    this.settled += (target - this.settled) * Math.min(dtMs / 2600, 1);
  }

  cloud(env: SceneryEnv): PixelCloud {
    const field = this.shape();
    const cloud: PixelCloud = [];
    const wet = env.weather?.rain ?? 0;

    for (let y = APEX - 2; y <= 0; y += 1) {
      for (let x = -20; x <= 20; x += 1) {
        const distance = field(x, y);
        if (distance > 0 || this.needledAway(x, y, distance)) {
          continue;
        }
        cloud.push({ x, y, ink: this.inkAt(field, x, y, distance, wet) });
      }
    }
    return rooted(cloud);
  }

  /**
   * Five tiers plus a trunk, sheared by the lean.
   *
   * Shearing the *domain* rather than moving the tiers is what keeps the
   * silhouette coherent: the tree bends as one piece, and the foot stays on
   * the ground because the shear is zero there.
   */
  private shape(): SdfField {
    const tiers: SdfField[] = [];
    for (let index = 0; index < TIERS; index += 1) {
      const t = index / (TIERS - 1);
      // Jittered per tier: evenly spaced tiers read as a stack of plates.
      const y = APEX + 6 + t * 34 + (pixelHash(index, 1, this.seed, 7) - 0.5) * 4;
      const spread = 3.5 + t * 12 + pixelHash(index, 0, this.seed, 2) * 2;
      tiers.push(sdEllipse(0, y, spread, 4.4 + t * 1.4));
    }
    const base = sdSmoothUnion(2.2, ...tiers, sdCapsule(0, 0, 0, APEX + 4, 1.7));
    const lean = this.lean;
    return warpField(base, (_x, y) => ({ x: (lean * -y) / -APEX, y: 0 }));
  }

  /** Needles: thin the outer shell against a noise threshold, keep the core solid. */
  private needledAway(x: number, y: number, distance: number): boolean {
    if (distance < -2.2) {
      return false;
    }
    const shell = 1 + distance / 2.2;
    return fbm2(x / 1.5, y / 2.6, this.seed, { octaves: 2 }) < shell * 0.62;
  }

  private inkAt(field: SdfField, x: number, y: number, distance: number, wet: number): InkId {
    const normal = fieldNormal(field, x, y);
    // Negative normal.y is "facing the sky" in cloud coordinates.
    const skyward = -normal.y;
    const depth = Math.min(-distance / 6, 1);
    if (skyward > 0.28 && this.settled > 0 && skyward * this.settled > 0.22 + depth * 0.5) {
      return rampInk(INK_RAMPS.tide, 0.7 + skyward * 0.3, { x, y });
    }
    // Rain darkens the needles by pulling the level down a step; a wet conifer
    // is nearly black except where the light skims it.
    const level = 0.25 + skyward * 0.5 - depth * 0.35 - wet * 0.22;
    return rampInk(INK_RAMPS.canopy, Math.max(level, 0.04), { x, y });
  }
}

export const SNOW_CONIFER: ScenerySpecies = {
  id: "snow-conifer",
  kind: "tree",
  label: "Spruce — SDF tiers with snow load",
  technique: "layered SDF + noise needling + normal-driven snow accumulation",
  notes:
    "Five smooth-unioned tiers sheared by one stiff spring. The needles are a noise threshold " +
    "applied only in the outer 2px shell, so the rim is spiky and the core is solid. Snow is not " +
    "drawn: it is a material picked wherever the field's normal faces the sky, deepening with the " +
    "weather and scoured back off by gusts. The same rule frosts anything with a normal.",
  footprint: { width: 52, height: 56, originX: 26, originY: 55 },
  create: (seed) => new SnowConifer(seed),
};
