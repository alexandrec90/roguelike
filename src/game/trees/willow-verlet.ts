/**
 * Species 2 — weeping fronds as **Verlet rope**, simulated rather than posed.
 *
 * A short trunk throws a handful of arching limbs; from each limb tip hangs a
 * pinned chain of points under gravity, pushed sideways by the wind field with
 * the force biting harder toward the free end. Nothing about the frond's shape
 * is authored: it is where a rope ends up.
 *
 * What this buys that no keyframe can is **persistence**. A gust arrives, the
 * fronds stream downwind; the gust drops, and they keep swinging, cross the
 * vertical, and settle over about a second and a half. The energy lives in the
 * points' own velocities, so the tree is still reacting to weather that has
 * already gone — which is exactly what the eye reads as "alive".
 *
 * The cost is state: this species integrates, so its lab capture is
 * reproducible by fixed sub-steps (`CHAIN_STEP_MS`) rather than by being a pure
 * function of elapsed time.
 */

import { strokeLine, type PixelCloud } from "../ink";
import { INK_RAMPS, rampInk } from "../shading";
import { pixelHash } from "../transforms";
import { windAt } from "../wind";
import { chainCloud, createChain, stepChain, type Chain } from "../procgen/verlet";
import { barkInk, rooted } from "./foliage";
import type { SceneryEnv, SceneryInstance, ScenerySpecies } from "../scenery";

const FROND_COUNT = 7;
const TRUNK_TOP = -23;

interface Anchor {
  readonly x: number;
  readonly y: number;
}

/** Limb tips arranged around a crown, seeded so no two willows match. */
function anchors(seed: number): readonly Anchor[] {
  return Array.from({ length: FROND_COUNT }, (_, index) => {
    const spread = (index / (FROND_COUNT - 1)) * 2 - 1;
    const wobble = pixelHash(index, 0, seed, 4) - 0.5;
    // The crown is a dome, so an outer limb reaches further out *and* hangs
    // lower. Without the second half the tips line up and the stand reads as a
    // curtain rather than as a canopy.
    return {
      x: Math.round(spread * 13 + wobble * 4),
      y: Math.round(TRUNK_TOP - 7 + Math.abs(spread) ** 1.4 * 8 + wobble * 4),
    };
  });
}

class WeepingWillow implements SceneryInstance {
  private readonly anchorPoints: readonly Anchor[];
  private readonly fronds: readonly Chain[];

  constructor(private readonly seed: number) {
    this.anchorPoints = anchors(seed);
    this.fronds = this.anchorPoints.map((anchor, index) =>
      createChain({
        anchorX: anchor.x,
        anchorY: anchor.y,
        segments: 6 + Math.floor(pixelHash(index, 0, seed, 5) * 5),
        restLength: 2.2,
        gravity: 0.00026,
        damping: 0.988,
        iterations: 4,
        seed: seed + index * 31,
      }),
    );
  }

  step(dtMs: number, env: SceneryEnv): void {
    this.fronds.forEach((frond, index) => {
      const anchor = this.anchorPoints[index];
      const gust = windAt(
        env.elapsedMs,
        env.fieldX + (anchor?.x ?? 0),
        env.fieldY + (anchor?.y ?? 0),
        env.wind,
      );
      stepChain(frond, dtMs, (_point, depth) => ({
        // Depth-weighted drag: the tip has the most sail area and the least
        // leverage holding it, so it moves several times as far as the collar.
        x: gust * 0.0000185 * (0.35 + depth * 1.5),
        y: 0,
      }));
    });
  }

  cloud(env: SceneryEnv): PixelCloud {
    const cloud: PixelCloud = [];
    this.drawTrunk(cloud);
    this.fronds.forEach((frond, index) => {
      for (const pixel of chainCloud(frond, "deep")) {
        cloud.push(pixel);
      }
      dressFrond(cloud, frond, this.seed + index, env.elapsedMs);
    });
    return rooted(cloud);
  }

  private drawTrunk(cloud: PixelCloud): void {
    const wood: PixelCloud = [];
    strokeLine(wood, { x: 0, y: -1 }, { x: 0, y: TRUNK_TOP }, "steel", 3);
    for (const anchor of this.anchorPoints) {
      // The limb arches: up to a shoulder above the tip, then out to it.
      const shoulderX = Math.round(anchor.x * 0.45);
      strokeLine(wood, { x: 0, y: TRUNK_TOP + 3 }, { x: shoulderX, y: anchor.y - 4 }, "steel", 2);
      strokeLine(wood, { x: shoulderX, y: anchor.y - 4 }, { x: anchor.x, y: anchor.y }, "steel");
    }
    for (const pixel of wood) {
      cloud.push({ x: pixel.x, y: pixel.y, ink: barkInk(pixel.x, pixel.y, this.seed, INK_RAMPS.bone) });
    }
  }
}

/** Leaves along the rope: a lit pixel either side, thinning toward the collar. */
function dressFrond(cloud: PixelCloud, frond: Chain, seed: number, elapsedMs: number): void {
  frond.points.forEach((point, index) => {
    if (index === 0) {
      return;
    }
    const depth = index / (frond.points.length - 1);
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    for (const side of [-1, 1]) {
      // Leaves crowd toward the free end, where a willow actually carries them.
      if (pixelHash(index, side, seed, 8) > depth * 1.15 + 0.05) {
        continue;
      }
      // A slow per-leaf flicker: the same pixel steps between two ramp levels
      // as the leaf turns edge-on to the light.
      const turn = pixelHash(index, side, seed, 9) + elapsedMs / 2400;
      const level = 0.45 + 0.4 * (turn % 1);
      cloud.push({ x: x + side, y, ink: rampInk(INK_RAMPS.canopy, level, { x: x + side, y }) });
    }
  });
}

export const WILLOW_VERLET: ScenerySpecies = {
  id: "willow-verlet",
  kind: "tree",
  label: "Willow — Verlet fronds",
  technique: "pinned Verlet chains under gravity + depth-weighted wind drag",
  notes:
    "Nine ropes of 6-10 points hang from arched limbs and are integrated in fixed 16 ms slices. " +
    "The wind force scales with distance down the rope, so the tips stream and the collars barely " +
    "move — and because the energy is in the points, the fronds keep swinging after a gust drops.",
  footprint: { width: 76, height: 56, originX: 38, originY: 55 },
  create: (seed) => new WeepingWillow(seed),
};
