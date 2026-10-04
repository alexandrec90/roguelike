/**
 * Every scenery species as a handful of solids.
 *
 * Which species stands where, and with what seed, is `scenery-features.ts` -
 * the same answer the pixel skin bakes its trees from - so a broadleaf in one
 * skin is a broadleaf, in the same spot, in the other. What a species *looks*
 * like is the skin's: here, a trunk and a faceted crown. Sizes come from
 * `speciesHeight`, so a tree is as tall against the hero in both.
 *
 * Coordinates are tiles, x and y on the ground, z up; `at` is the foot.
 */

import { speciesHeight } from "../../game/scenery-features";
import { WALL_RISE } from "../../game/projection";
import { Kind, MeshBuilder, mixRgb, type Rgb, type Vec3 } from "./mesh";
import { LOWPOLY, hash01 } from "./palette";
import { blob, cone, disc, frustum } from "./primitives";

/** How dark a body's contact shadow is, before the light's own strength. */
const SHADOW_ALPHA = 0.32;

/**
 * `speciesHeight` is how far past the horizon a body can still show - a bound,
 * generous on purpose. The bodies the pixel skin actually draws stand at about
 * this share of it, measured side by side in the two skins.
 */
const DRAWN_SHARE = 0.6;

type SpeciesMesh = (solid: MeshBuilder, at: Vec3, height: number, seed: number) => number;

/** Draw one species at `at`, and its shadow under it. Returns nothing; both builders grow. */
export function sceneryMesh(solid: MeshBuilder, sheer: MeshBuilder, species: string, at: Vec3, seed: number): void {
  const height = (speciesHeight(species) / WALL_RISE) * DRAWN_SHARE * (0.85 + hash01(seed) * 0.3);
  const build = SPECIES[species] ?? SPECIES.bush!;
  const spread = build(solid, at, height, seed);
  shadowUnder(sheer, at, spread);
}

/** A soft dark disc under a body, anchored at its foot so it shrinks with it on the lip. */
export function shadowUnder(sheer: MeshBuilder, at: Vec3, radius: number): void {
  disc(sheer, [at[0], at[1], at[2] + 0.01], radius, 8, {
    colour: LOWPOLY.shadow,
    kind: Kind.shadow,
    alpha: SHADOW_ALPHA,
    anchor: [at[0], at[1]],
  });
}

/** A five-sided trunk `height` tall, tapering from `radius` to a little over half of it. */
function trunk(solid: MeshBuilder, at: Vec3, height: number, radius: number, anchor: readonly [number, number]): void {
  frustum(solid, { from: at, to: [at[0], at[1], at[2] + height], r0: radius, r1: radius * 0.6, sides: 5 }, { colour: LOWPOLY.bark, anchor });
}

function broadleaf(crown: Rgb, lobes: number, flatten: number): SpeciesMesh {
  return (solid, at, height, seed) => {
    const anchor = [at[0], at[1]] as const;
    const trunkTop = height * 0.35;
    trunk(solid, at, trunkTop + 0.3, 0.14, anchor);
    const radius = height * 0.3;
    for (let lobe = 0; lobe < lobes; lobe += 1) {
      const angle = hash01(seed + lobe * 31) * Math.PI * 2;
      const off = lobe === 0 ? 0 : radius * 0.55;
      const r = lobe === 0 ? radius : radius * 0.7;
      const centre: Vec3 = [at[0] + Math.cos(angle) * off, at[1] + Math.sin(angle) * off, at[2] + trunkTop + r * flatten];
      const colour = mixRgb(crown, LOWPOLY.leafLight, hash01(seed + lobe) * 0.35);
      blob(solid, centre, [r, r, r * flatten], { colour, anchor }, seed + lobe * 977);
    }
    return radius * 0.95;
  };
}

function conifer(solid: MeshBuilder, at: Vec3, height: number, seed: number): number {
  const anchor = [at[0], at[1]] as const;
  trunk(solid, at, height * 0.25, 0.13, anchor);
  const tiers = 3;
  const base = height * 0.3;
  const phase = hash01(seed) * Math.PI;
  for (let tier = 0; tier < tiers; tier += 1) {
    const share = tier / tiers;
    const radius = height * 0.24 * (1 - share * 0.55);
    const z = at[2] + height * 0.15 + share * (height - base) * 0.75;
    const colour = tier === tiers - 1 ? mixRgb(LOWPOLY.pine, LOWPOLY.snow, 0.35) : LOWPOLY.pine;
    cone(solid, { base: [at[0], at[1], z], height: base * (1 - share * 0.3), radius, sides: 6, phase: phase + tier }, { colour, anchor });
  }
  return height * 0.2;
}

function bush(solid: MeshBuilder, at: Vec3, height: number, seed: number): number {
  const r = height * 0.55;
  blob(solid, [at[0], at[1], at[2] + r * 0.6], [r, r, r * 0.75], { colour: LOWPOLY.bush, anchor: [at[0], at[1]] }, seed, 0.22);
  return r;
}

function boulder(solid: MeshBuilder, at: Vec3, height: number, seed: number): number {
  const r = height * 0.55;
  blob(solid, [at[0], at[1], at[2] + r * 0.45], [r, r * 0.85, r * 0.7], { colour: LOWPOLY.rock, anchor: [at[0], at[1]] }, seed, 0.3);
  return r * 0.9;
}

function mushrooms(solid: MeshBuilder, at: Vec3, height: number, seed: number): number {
  const anchor = [at[0], at[1]] as const;
  const count = 5;
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + hash01(seed) * 2;
    const ring = 0.45;
    const h = height * (0.6 + hash01(seed + i) * 0.4);
    const foot: Vec3 = [at[0] + Math.cos(angle) * ring, at[1] + Math.sin(angle) * ring, at[2]];
    frustum(solid, { from: foot, to: [foot[0], foot[1], foot[2] + h], r0: 0.05, r1: 0.04, sides: 4 }, { colour: LOWPOLY.mushroomStem, anchor });
    cone(solid, { base: [foot[0], foot[1], foot[2] + h * 0.9], height: h * 0.4, radius: h * 0.45, sides: 6 }, { colour: LOWPOLY.mushroomCap, anchor });
  }
  return 0.6;
}

const SPECIES: Readonly<Record<string, SpeciesMesh>> = {
  "sdf-crown": broadleaf(LOWPOLY.leaf, 1, 0.9),
  "oak-recursive": broadleaf(mixRgb(LOWPOLY.leaf, LOWPOLY.pine, 0.3), 3, 0.75),
  "noise-canopy": broadleaf(LOWPOLY.leafLight, 2, 0.65),
  "colonized-ash": broadleaf(LOWPOLY.ash, 2, 1),
  "snow-conifer": conifer,
  bush,
  boulder,
  "mushroom-ring": mushrooms,
};

/** Every species this skin has a body for - a test holds it to `PLACED_SPECIES`. */
export const MESHED_SPECIES: readonly string[] = Object.keys(SPECIES);
