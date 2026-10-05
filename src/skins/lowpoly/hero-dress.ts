/**
 * What the low-poly hero is made of: an undead skeleton carrying a stick.
 *
 * The *rig* is still the shared one (`HERO_EQUIPPED`): the same bones, posed
 * by the same clips and turned by the same yaw, so a skin decides how he looks
 * and never how he moves. Only the bodies on those bones are this skin's own,
 * because "bare bone" is a look the shared outfit (`HERO_VOLUMES`) has no
 * material for. The stick rides the rig's `sword` bone, so `SWING` swings it.
 *
 * Every piece is a capsule (`from`..`to`) or a sphere (`from` alone) along its
 * bone, in rig pixels, exactly as a `VolumePiece` - but coloured straight from
 * this skin's palette rather than through a pixel-skin material.
 */

import { vec3, type Vec3, type VolumePiece } from "../../game/rig";
import type { LowpolyColour } from "./palette";

export interface DressPiece extends Pick<VolumePiece, "from" | "to" | "radius" | "radiusEnd" | "offset"> {
  readonly colour: LowpolyColour;
  /** Catches fire when the blade - here, the stick - is enchanted. */
  readonly burns?: boolean;
}

/** Upper bone, a knob of a joint, lower bone, a bony hand. */
const ARM: readonly DressPiece[] = [
  { from: 0.04, to: 0.47, radius: 0.48, radiusEnd: 0.4, colour: "bone" },
  { from: 0.5, radius: 0.62, colour: "bone" },
  { from: 0.53, to: 0.92, radius: 0.4, radiusEnd: 0.34, colour: "bone" },
  { from: 1, radius: 0.78, colour: "bone" },
];

/** Thigh bone, knee, shin, and a foot of bones set forward of the ankle. */
const LEG: readonly DressPiece[] = [
  { from: 0.03, to: 0.47, radius: 0.58, radiusEnd: 0.48, colour: "bone" },
  { from: 0.5, radius: 0.78, colour: "bone" },
  { from: 0.53, to: 0.94, radius: 0.48, radiusEnd: 0.4, colour: "bone" },
  { from: 0.97, radius: 0.9, colour: "bone", offset: vec3(0, 0.7, 0.2) },
];

/** The cranium: a sphere off the head bone's end, rig pixels. */
export const SKULL = { at: vec3(0, 0.3, 0.6), radius: 3 } as const;

/**
 * Three ribs stacked round the spine with daylight between them, a pelvis
 * bowl at the hips, and a skull with a jaw hung under it. The gaps are what
 * make it read as a skeleton rather than a pale man: the spine shows through.
 */
export const SKELETON_DRESS: Readonly<Record<string, readonly DressPiece[]>> = {
  torso: [
    { from: 0, to: 0.16, radius: 1.95, radiusEnd: 1.45, colour: "bone" },
    { from: 0, to: 1, radius: 0.5, colour: "bone", offset: vec3(0, -0.5, 0) },
    { from: 0.44, to: 0.52, radius: 1.95, radiusEnd: 2.1, colour: "bone" },
    { from: 0.61, to: 0.69, radius: 2.15, radiusEnd: 2.25, colour: "bone" },
    { from: 0.78, to: 0.87, radius: 2.2, radiusEnd: 1.9, colour: "bone" },
  ],
  head: [
    { from: 0, to: 0.5, radius: 0.5, colour: "bone" },
    { from: 1, radius: SKULL.radius, colour: "bone", offset: SKULL.at },
    { from: 1, radius: 1.75, colour: "bone", offset: vec3(0, 1.1, -1.5) },
  ],
  "shoulder-l": [
    { from: 0, to: 0.9, radius: 0.4, colour: "bone" },
    { from: 1, radius: 0.72, colour: "bone" },
  ],
  "shoulder-r": [
    { from: 0, to: 0.9, radius: 0.4, colour: "bone" },
    { from: 1, radius: 0.72, colour: "bone" },
  ],
  "arm-l": ARM,
  "arm-r": ARM,
  "leg-l": LEG,
  "leg-r": LEG,
};

/**
 * A plain stick picked up off the ground: a shaft that thins toward its tip,
 * and a knot where a twig was broken off - the one bump that says branch
 * rather than staff. It starts a little behind the fist, as the sword's grip did.
 */
export const STICK_DRESS: readonly DressPiece[] = [
  { from: -0.12, to: 0.55, radius: 0.55, radiusEnd: 0.47, colour: "bark", burns: true },
  { from: 0.55, to: 0.95, radius: 0.47, radiusEnd: 0.34, colour: "bark", burns: true },
  { from: 0.58, radius: 0.4, colour: "bark", offset: vec3(0.45, 0, 0.1), burns: true },
];

/** How far a hole's dark sphere stands proud of the cranium, rig pixels. */
const HOLE_PROUD = 0.14;

/**
 * A hole in the skull: a dark sphere sunk along a direction from the cranium's
 * centre until only a shallow cap breaks the surface. A sphere set *on* the
 * face reads as a goggling eyeball; one sunk into it reads as a hollow.
 */
function hole(toward: Vec3, radius: number): { readonly at: Vec3; readonly radius: number } {
  const length = Math.hypot(toward.x, toward.y, toward.z);
  const reach = (SKULL.radius + HOLE_PROUD - radius) / length;
  return { at: vec3(SKULL.at.x + toward.x * reach, SKULL.at.y + toward.y * reach, SKULL.at.z + toward.z * reach), radius };
}

/**
 * The skull's dark holes, from the head bone's end in rig pixels as authored
 * for the front view: two eye sockets and the nose.
 */
export const SKULL_HOLES: readonly { readonly at: Vec3; readonly radius: number }[] = [
  hole(vec3(-0.4, 0.88, -0.3), 0.8),
  hole(vec3(0.4, 0.88, -0.3), 0.8),
  hole(vec3(0, 0.82, -0.58), 0.45),
];
