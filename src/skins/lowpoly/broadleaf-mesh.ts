/**
 * A broadleaf as a branching skeleton dressed in layered leaves.
 *
 * A crown used to be one faceted ball on a stick. What reads as a *tree* at
 * this scale is the structure under it: a trunk that forks, limbs that leave
 * it at an angle, twigs fanning upward off each limb, and at every twig's end
 * a clump of serrated, drooping plates (`frond`) stacked in tiers - the gaps
 * between clumps showing the dark wood, the tiers catching the light one by
 * one. A species is a `Canopy`, a handful of proportions; the seed does the rest.
 *
 * Coordinates are tiles, x and y on the ground, z up; `at` is the foot.
 */

import { Kind, type MeshBuilder, mixRgb, type Rgb, shadeRgb, type Vec3 } from "./mesh";
import { LOWPOLY, hash01, seedOf } from "./palette";
import { frond, frustum } from "./primitives";

/** A broadleaf species' proportions, every length a share of the tree's height. */
export interface Canopy {
  readonly leaf: Rgb;
  /** Trunk, foot to fork. */
  readonly trunk: number;
  /** Main limbs leaving the fork. */
  readonly limbs: number;
  /** One limb, fork to its twigs. */
  readonly limb: number;
  /** Radians a limb leans out of the trunk's line. */
  readonly spread: number;
  /** Twigs fanning upward off each limb's end, each carrying a clump. */
  readonly twigs: number;
  /** One twig. */
  readonly twig: number;
  /** A clump's widest tier, as a radius. */
  readonly clump: number;
  /** Tiers of plates in a clump. */
  readonly tiers: number;
  /** A clump over the fork too, for a fuller crown. */
  readonly heart?: boolean;
}

/** A trunk's radius at the foot, as a share of the tree's height. */
const TRUNK_RADIUS = 0.04;

/** Points on a clump's lowest plate; each tier above has one fewer. */
const BASE_TEETH = 6;

/** The way `d` points, leant `theta` off it toward `phi` round it. `phi` = π/2 is up, where up is defined. */
function lean(d: Vec3, theta: number, phi: number): Vec3 {
  const ref: Vec3 = Math.abs(d[2]) < 0.95 ? [0, 0, 1] : [1, 0, 0];
  const u = unit(cross(d, ref));
  const v = cross(u, d);
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const cu = Math.cos(phi) * s;
  const cv = Math.sin(phi) * s;
  return unit([d[0] * c + u[0] * cu + v[0] * cv, d[1] * c + u[1] * cu + v[1] * cv, d[2] * c + u[2] * cu + v[2] * cv]);
}

/** A broadleaf of this shape: draws it, and returns how far its crown reaches from the foot. */
export function broadleafMesh(canopy: Canopy) {
  return (solid: MeshBuilder, at: Vec3, height: number, seed: number): number => {
    const anchor = [at[0], at[1]] as const;
    const rand = (salt: number): number => hash01(seedOf(seed, salt));
    // Wood and leaves alike sway as one body about the foot (`sway.ts`).
    const wood = { colour: LOWPOLY.bark, kind: Kind.foliage, anchor };
    let reach = 0;

    const clump = (centre: Vec3, radius: number, salt: number): void => {
      const leaf = mixRgb(canopy.leaf, LOWPOLY.leafLight, rand(salt) * 0.25);
      for (let tier = 0; tier < canopy.tiers; tier += 1) {
        const r = radius * (1 - tier * 0.28);
        const drift = radius * 0.12;
        const plate: Vec3 = [
          centre[0] + (rand(salt + tier * 3 + 1) - 0.5) * drift,
          centre[1] + (rand(salt + tier * 3 + 2) - 0.5) * drift,
          centre[2] + (tier - 0.4) * radius * 0.3,
        ];
        // The lowest tier is in its neighbours' shade: darker, so the stack reads as a mass.
        const colour = shadeRgb(leaf, -0.14 + (tier / Math.max(canopy.tiers - 1, 1)) * 0.18);
        const teeth = Math.max(BASE_TEETH - tier, 4);
        frond(
          solid,
          { centre: plate, radius: r, teeth, lift: r * 0.3, droop: r * 0.22, notch: 0.74, phase: rand(salt + tier * 3 + 3) * Math.PI },
          { colour, kind: Kind.foliage, anchor },
          seedOf(seed, salt, tier),
        );
      }
      reach = Math.max(reach, Math.hypot(centre[0] - at[0], centre[1] - at[1]) + radius);
    };

    const r0 = height * TRUNK_RADIUS;
    const up = lean([0, 0, 1], rand(1) * 0.12, rand(2) * Math.PI * 2);
    const fork = along(at, up, height * canopy.trunk);
    frustum(solid, { from: at, to: fork, r0, r1: r0 * 0.7, sides: 5 }, wood);

    const turn = rand(3) * Math.PI * 2;
    for (let i = 0; i < canopy.limbs; i += 1) {
      const azimuth = turn + (i / canopy.limbs) * Math.PI * 2 + (rand(10 + i) - 0.5) * 0.9;
      const dir = lean(up, canopy.spread * (0.8 + rand(20 + i) * 0.4), azimuth);
      const end = along(fork, dir, height * canopy.limb * (0.85 + rand(30 + i) * 0.3));
      frustum(solid, { from: fork, to: end, r0: r0 * 0.6, r1: r0 * 0.38, sides: 4, capped: false }, wood);
      for (let j = 0; j < canopy.twigs; j += 1) {
        const fan = canopy.twigs === 1 ? 0 : (j / (canopy.twigs - 1) - 0.5) * 2.2;
        const twigDir = lean(dir, 0.5 + rand(40 + i * 7 + j) * 0.3, Math.PI / 2 + fan);
        const tip = along(end, twigDir, height * canopy.twig * (0.8 + rand(50 + i * 7 + j) * 0.4));
        frustum(solid, { from: end, to: tip, r0: r0 * 0.36, r1: r0 * 0.2, sides: 3, capped: false }, wood);
        clump(tip, height * canopy.clump * (0.85 + rand(60 + i * 7 + j) * 0.3), 100 + (i * 7 + j) * 16);
      }
    }
    if (canopy.heart === true) {
      clump(along(fork, up, height * canopy.limb * 0.9), height * canopy.clump * 1.1, 1000);
    }
    // A crown is open, and the sun is rarely overhead: its shadow is the dense middle of it.
    return reach * 0.55;
  };
}

function along(from: Vec3, dir: Vec3, length: number): Vec3 {
  return [from[0] + dir[0] * length, from[1] + dir[1] * length, from[2] + dir[2] * length];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
}
