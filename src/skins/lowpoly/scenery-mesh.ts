/**
 * Every scenery species as a handful of solids.
 *
 * Which species stands where, and with what seed, is `scenery-features.ts` -
 * the same answer the pixel skin bakes its trees from - so a broadleaf in one
 * skin is a broadleaf, in the same spot, in the other. What a species *looks*
 * like is the skin's: here, a broadleaf is a forking skeleton in tiers of
 * leaves (`broadleaf-mesh.ts`) and a conifer stacked cones. Sizes come from
 * `speciesHeight`, so a tree is as tall against the hero in both.
 *
 * Coordinates are tiles, x and y on the ground, z up; `at` is the foot.
 */

import { speciesHeight } from "../../game/scenery-features";
import { WALL_RISE } from "../../game/projection";
import { broadleafMesh } from "./broadleaf-mesh";
import type { ImpostorBuilder } from "./impostor";
import { FLAT_LOOK, type Look } from "./look";
import { Kind, MeshBuilder, mixRgb, type Vec3 } from "./mesh";
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

/** A species' body; given `leaves`, its foliage is impostor balls there (`?leaves=impostor`) where it has any. */
type SpeciesMesh = (solid: MeshBuilder, at: Vec3, height: number, seed: number, look: Look, leaves?: ImpostorBuilder) => number;

/** The height of the drawn ground under a point of the builder's own frame, tiles. */
export type GroundUnder = (x: number, y: number) => number;

/**
 * How a body is laid: in which look, on what ground (omitted, level), and with
 * its foliage as impostor balls in `leaves` (omitted, mesh).
 */
export interface SceneryLay {
  readonly look?: Look;
  readonly ground?: GroundUnder;
  readonly leaves?: ImpostorBuilder;
}

/**
 * Draw one species at `at`, and its shadow under it, lying on the `ground` it
 * is laid on. Returns nothing; the builders grow.
 */
export function sceneryMesh(solid: MeshBuilder, sheer: MeshBuilder, species: string, at: Vec3, seed: number, lay: SceneryLay = {}): void {
  const height = (speciesHeight(species) / WALL_RISE) * DRAWN_SHARE * (0.85 + hash01(seed) * 0.3);
  const build = SPECIES[species] ?? SPECIES.bush!;
  const spread = build(solid, at, height, seed, lay.look ?? FLAT_LOOK, lay.leaves);
  shadowUnder(sheer, at, spread, lay.ground);
}

/** Corners round a contact shadow. */
const SHADOW_SIDES = 8;

/**
 * A soft dark disc under a body, anchored at its foot so it shrinks with it on
 * the lip. Given the `ground` under it, each corner lies on the slope rather
 * than the disc hanging level off a hillside.
 */
export function shadowUnder(sheer: MeshBuilder, at: Vec3, radius: number, ground?: GroundUnder): void {
  const style = { colour: LOWPOLY.shadow, kind: Kind.shadow, alpha: SHADOW_ALPHA, anchor: [at[0], at[1]] as const };
  if (ground === undefined) {
    disc(sheer, [at[0], at[1], at[2] + 0.01], radius, SHADOW_SIDES, style);
    return;
  }
  const lie = (x: number, y: number): Vec3 => [x, y, ground(x, y) + 0.01];
  const centre = lie(at[0], at[1]);
  const rim = Array.from({ length: SHADOW_SIDES }, (_, i) => {
    const angle = (i / SHADOW_SIDES) * Math.PI * 2;
    return lie(at[0] + Math.cos(angle) * radius, at[1] + Math.sin(angle) * radius);
  });
  for (let i = 0; i < SHADOW_SIDES; i += 1) {
    sheer.tri(centre, rim[i]!, rim[(i + 1) % SHADOW_SIDES]!, style);
  }
}

/** A five-sided trunk `height` tall, tapering from `radius` to a little over half of it. */
function trunk(solid: MeshBuilder, at: Vec3, height: number, radius: number, anchor: readonly [number, number]): void {
  frustum(solid, { from: at, to: [at[0], at[1], at[2] + height], r0: radius, r1: radius * 0.6, sides: 5 }, { colour: LOWPOLY.bark, kind: Kind.foliage, anchor });
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
    cone(solid, { base: [at[0], at[1], z], height: base * (1 - share * 0.3), radius, sides: 6, phase: phase + tier }, { colour, kind: Kind.foliage, anchor });
  }
  return height * 0.2;
}

function bush(solid: MeshBuilder, at: Vec3, height: number, seed: number, look: Look, leaves?: ImpostorBuilder): number {
  const r = height * 0.55;
  const anchor = [at[0], at[1]] as const;
  if (leaves !== undefined) {
    // A mound of three: a big ball and two smaller ones leaning off it.
    const turn = hash01(seed + 3) * Math.PI * 2;
    leaves.ball({ centre: [at[0], at[1], at[2] + r * 0.55], foot: anchor, radius: r * 0.78, colour: LOWPOLY.bush, kind: Kind.foliage, seed: hash01(seed + 5) });
    for (const side of [0, 1]) {
      const angle = turn + side * 2.4;
      const offset = r * 0.62;
      leaves.ball({
        centre: [at[0] + Math.cos(angle) * offset, at[1] + Math.sin(angle) * offset, at[2] + r * 0.38],
        foot: anchor,
        radius: r * (0.5 + hash01(seed + 7 + side) * 0.12),
        colour: mixRgb(LOWPOLY.bush, LOWPOLY.leafLight, 0.2 * side),
        kind: Kind.foliage,
        seed: hash01(seed + 11 + side),
      });
    }
    return r;
  }
  blob(solid, [at[0], at[1], at[2] + r * 0.6], [r, r, r * 0.75], { colour: LOWPOLY.bush, kind: Kind.foliage, anchor }, seed, { jitter: 0.22, look });
  return r;
}

function boulder(solid: MeshBuilder, at: Vec3, height: number, seed: number, look: Look): number {
  const r = height * 0.55;
  blob(solid, [at[0], at[1], at[2] + r * 0.45], [r, r * 0.85, r * 0.7], { colour: LOWPOLY.rock, anchor: [at[0], at[1]] }, seed, { jitter: 0.3, look });
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
    frustum(solid, { from: foot, to: [foot[0], foot[1], foot[2] + h], r0: 0.05, r1: 0.04, sides: 4 }, { colour: LOWPOLY.mushroomStem, kind: Kind.sprig, anchor });
    cone(solid, { base: [foot[0], foot[1], foot[2] + h * 0.9], height: h * 0.4, radius: h * 0.45, sides: 6 }, { colour: LOWPOLY.mushroomCap, kind: Kind.sprig, anchor });
  }
  return 0.6;
}

const SPECIES: Readonly<Record<string, SpeciesMesh>> = {
  // A round, full crown: three limbs and a clump over the fork.
  "sdf-crown": broadleafMesh({ leaf: LOWPOLY.leaf, trunk: 0.36, limbs: 3, limb: 0.28, spread: 0.75, twigs: 2, twig: 0.17, clump: 0.18, tiers: 3, heart: true }),
  // Low and wide: a short bole, limbs flung out nearly level.
  "oak-recursive": broadleafMesh({ leaf: mixRgb(LOWPOLY.leaf, LOWPOLY.pine, 0.3), trunk: 0.3, limbs: 3, limb: 0.32, spread: 1.05, twigs: 2, twig: 0.18, clump: 0.19, tiers: 2 }),
  // Tall and open, turning: two limbs climbing steeply, gaps between the clumps.
  "noise-canopy": broadleafMesh({ leaf: LOWPOLY.autumn, trunk: 0.48, limbs: 2, limb: 0.26, spread: 0.55, twigs: 3, twig: 0.18, clump: 0.16, tiers: 3 }),
  // Slender, pale and sparse.
  "colonized-ash": broadleafMesh({ leaf: LOWPOLY.ash, trunk: 0.52, limbs: 2, limb: 0.24, spread: 0.5, twigs: 2, twig: 0.16, clump: 0.15, tiers: 2, heart: true }),
  "snow-conifer": conifer,
  bush,
  boulder,
  "mushroom-ring": mushrooms,
};

/** Every species this skin has a body for - a test holds it to `PLACED_SPECIES`. */
export const MESHED_SPECIES: readonly string[] = Object.keys(SPECIES);
