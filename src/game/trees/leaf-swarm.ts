/**
 * Species 7 — the canopy **is** the particle system.
 *
 * There is no foliage mass and no threshold field. Every leaf is one mote,
 * spring-tethered to an anchor point on a twig; the wind pulls on the tether
 * and the leaf oscillates around it. When the gust envelope crosses a
 * threshold, a seeded fraction of the tethers *break*: those leaves stop being
 * canopy and become debris, advected by a curl flow until they hit the ground,
 * where they lie as litter. New buds refill the empty anchors slowly.
 *
 * This is the species that couples weather to the tree's *state* rather than to
 * its pose. Watch it through one squall and the tree is measurably barer
 * afterwards. Nothing else here can do that, and no drawn frame ever will.
 *
 * The cost is honesty about scale: a few hundred motes is a canopy at 320x180,
 * and the pool is capped, so a long storm strips the tree rather than melting
 * the frame rate.
 */

import { strokeLine, type PixelCloud } from "../ink";
import { curlFlow } from "../procgen/noise";
import { INK_RAMPS, rampInk } from "../shading";
import { pixelHash } from "../transforms";
import { gustAt, windAt } from "../wind";
import { barkInk, rooted } from "./foliage";
import type { SceneryEnv, SceneryInstance, ScenerySpecies } from "../scenery";

const ANCHORS = 260;
const TEAR_GUST = 0.92;

interface Leaf {
  /** The twig this leaf belongs to; where it springs back to. */
  readonly homeX: number;
  readonly homeY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Attached, torn loose, or a bare anchor waiting to bud. */
  state: "held" | "loose" | "bare";
  restMs: number;
}

/** Anchors on an elliptical crown shell, seeded — the twigs, implied. */
function budAnchors(seed: number): Leaf[] {
  return Array.from({ length: ANCHORS }, (_, index) => {
    const angle = pixelHash(index, 0, seed, 1) * Math.PI * 2;
    const radius = Math.sqrt(pixelHash(index, 0, seed, 2));
    const x = Math.cos(angle) * radius * 17;
    const y = -28 + Math.sin(angle) * radius * 11;
    return { homeX: x, homeY: y, x, y, vx: 0, vy: 0, state: "held" as const, restMs: 0 };
  });
}

class LeafSwarm implements SceneryInstance {
  private readonly leaves: Leaf[];

  constructor(private readonly seed: number) {
    this.leaves = budAnchors(seed);
  }

  step(dtMs: number, env: SceneryEnv): void {
    const delta = Math.min(Math.max(dtMs, 0), 100);
    const gust = gustAt(env.elapsedMs, env.wind);
    const wind = windAt(env.elapsedMs, env.fieldX, env.fieldY - 26, env.wind);
    this.leaves.forEach((leaf, index) => {
      if (leaf.state === "bare") {
        this.bud(leaf, delta, index);
        return;
      }
      if (leaf.state === "held") {
        this.holdOn(leaf, delta, wind, gust, index);
        return;
      }
      this.tumble(leaf, delta, env, wind);
    });
  }

  /** A tethered leaf: a spring back to the twig, plus the wind on its face. */
  private holdOn(leaf: Leaf, delta: number, wind: number, gust: number, index: number): void {
    const sail = 0.9 + pixelHash(index, 0, this.seed, 3) * 0.6;
    leaf.vx += (wind * 0.00055 * sail - (leaf.x - leaf.homeX) * 0.0022) * delta;
    leaf.vy += (-(leaf.y - leaf.homeY) * 0.0022 - Math.abs(wind) * 0.00008) * delta;
    leaf.vx *= 0.94;
    leaf.vy *= 0.94;
    leaf.x += leaf.vx * delta;
    leaf.y += leaf.vy * delta;
    // The tear roll is seeded per leaf and only ever consulted above the
    // threshold, so a calm day never strips a tree by accident.
    if (gust > TEAR_GUST && pixelHash(index, Math.floor(leaf.x), this.seed, 4) > 0.996) {
      leaf.state = "loose";
    }
  }

  private tumble(leaf: Leaf, delta: number, env: SceneryEnv, wind: number): void {
    const swirl = curlFlow(leaf.x / 11, leaf.y / 11, env.elapsedMs / 900, this.seed, 0.6);
    leaf.vx += (swirl.x * 0.00035 + wind * 0.0004) * delta;
    // Leaves fall slowly and refuse to fall straight: the swirl term is the
    // whole difference between a leaf and a pebble.
    leaf.vy += (swirl.y * 0.0003 + 0.000042) * delta;
    leaf.vx *= 0.985;
    leaf.vy *= 0.985;
    leaf.x += leaf.vx * delta;
    leaf.y += leaf.vy * delta;
    if (leaf.y >= 0) {
      leaf.y = 0;
      leaf.vx = 0;
      leaf.vy = 0;
      leaf.state = "bare";
      leaf.restMs = 0;
    }
  }

  /** A bare anchor lies as litter for a while, then buds again. */
  private bud(leaf: Leaf, delta: number, index: number): void {
    leaf.restMs += delta;
    if (leaf.restMs < 6000 + pixelHash(index, 0, this.seed, 5) * 9000) {
      return;
    }
    leaf.state = "held";
    leaf.x = leaf.homeX;
    leaf.y = leaf.homeY;
    leaf.vx = 0;
    leaf.vy = 0;
  }

  cloud(): PixelCloud {
    const cloud: PixelCloud = [];
    const wood: PixelCloud = [];
    strokeLine(wood, { x: 0, y: -1 }, { x: 0, y: -20 }, "steel", 3);
    for (const angle of [-0.85, -0.3, 0.35, 0.9]) {
      strokeLine(
        wood,
        { x: 0, y: -18 },
        { x: Math.round(Math.sin(angle) * 15), y: Math.round(-20 - Math.cos(angle) * 11) },
        "steel",
        2,
      );
    }
    for (const pixel of wood) {
      cloud.push({ x: pixel.x, y: pixel.y, ink: barkInk(pixel.x, pixel.y, this.seed, INK_RAMPS.bone) });
    }

    this.leaves.forEach((leaf, index) => {
      if (leaf.state === "bare" && leaf.restMs > 40) {
        return;
      }
      const x = Math.round(leaf.x);
      const y = Math.round(leaf.y);
      // Loose leaves ink one step brighter: catching the light as they turn is
      // what makes the eye follow them out of the canopy.
      const level = leaf.state === "loose" ? 0.85 : 0.3 + pixelHash(index, 0, this.seed, 6) * 0.45;
      cloud.push({ x, y, ink: rampInk(INK_RAMPS.canopy, level, { x, y }) });
    });
    return rooted(cloud);
  }
}

export const LEAF_SWARM: ScenerySpecies = {
  id: "leaf-swarm",
  kind: "tree",
  label: "Poplar — leaf swarm (particles)",
  technique: "spring-tethered leaf motes, torn loose by gusts, advected by curl flow",
  notes:
    "The canopy has no mass — it is 130 leaves on springs. Above a gust threshold the tethers break " +
    "and those leaves tumble away on a curl field, land as litter, and bud back over ten seconds. " +
    "This is the only species where the weather changes the tree's state, not just its pose: run a " +
    "squall and it is visibly barer afterwards.",
  footprint: { width: 74, height: 56, originX: 37, originY: 55 },
  create: (seed) => new LeafSwarm(seed),
};
