/**
 * Authored rigs: the humanoid skeleton, its gear, and its clips.
 *
 * This is the file an agent edits to give a character a new move or a new
 * piece of equipment. A clip is a handful of keyframes of 3D directions; a
 * sword is one gear bone plus a crossguard stamp; a hat is one mask. Nothing
 * here rasterizes — `rig.ts` does that — so everything in this file is data,
 * diffs line by line, and is testable without a canvas.
 *
 * Proportions: the humanoid stands ~20 world pixels tall — a little over one
 * WALL_RISE, grown from 16 when he gained a body, so the shading has room to
 * say "round" and the head is big enough to carry a face. Feet at z=0; the
 * model anchors at its foot on the ground.
 *
 * Every bone also carries **pieces** (`HERO_VOLUMES`): the radius and material
 * the volumetric renderer (`hero/rig-volume.ts`) fills it with. The line
 * renderer ignores them, so both draw from the one skeleton.
 */

import type { FaceSpec } from "./hero/rig-volume";
import type { VolumePiece } from "./rig";
import { maskFromRows } from "./ink";
import {
  equip,
  vec3,
  type Clip,
  type RigModel,
  type RigPart,
  type RigPose,
  type SkeletonDef,
} from "./rig";

/** Hip height: legs reach the ground from here in the base pose. */
const HIP_Z = 7.5;

/**
 * Shoulders are bones of their own so the arms hang from the edge of the
 * chest rather than out of the neck; clips never key them, so every existing
 * clip still owns the arms exactly as before.
 */
export const HUMANOID_SKELETON: SkeletonDef = {
  bones: [
    { name: "torso", parent: null, attach: "end", length: 5.5 },
    { name: "head", parent: "torso", attach: "end", length: 2.6 },
    { name: "shoulder-l", parent: "torso", attach: "end", length: 2 },
    { name: "shoulder-r", parent: "torso", attach: "end", length: 2 },
    { name: "arm-l", parent: "shoulder-l", attach: "end", length: 5 },
    { name: "arm-r", parent: "shoulder-r", attach: "end", length: 5 },
    { name: "hip-l", parent: "torso", attach: "start", length: 1.4 },
    { name: "hip-r", parent: "torso", attach: "start", length: 1.4 },
    { name: "leg-l", parent: "hip-l", attach: "end", length: 7.5 },
    { name: "leg-r", parent: "hip-r", attach: "end", length: 7.5 },
  ],
};

export const HUMANOID_BASE: RigPose = {
  root: vec3(0, 0, HIP_Z),
  bones: {
    torso: vec3(0, 0, 1),
    head: vec3(0, 0, 1),
    "shoulder-l": vec3(-1, 0, -0.3),
    "shoulder-r": vec3(1, 0, -0.3),
    "arm-l": vec3(-0.9, 0.25, -0.9),
    "arm-r": vec3(0.9, 0.25, -0.9),
    "hip-l": vec3(-1, 0, 0),
    "hip-r": vec3(1, 0, 0),
    "leg-l": vec3(0, 0, -1),
    "leg-r": vec3(0, 0, -1),
  },
};

const HEAD_MASK = maskFromRows([
  ".###.",
  "#####",
  "#####",
  ".###.",
]);

/**
 * One eye, stamped twice. Front-only, and the one detail that tells front from
 * back: each sits a pixel either side of centre and a little proud of the face,
 * so turning slides the pair across the head - both from the front, shifted on
 * a three-quarter view, one in profile, none from behind.
 */
const EYE_MASK = maskFromRows(["#"]);
const EYE_OUT = 1.2;

/**
 * The adventurer's outfit, as bodies on bones: blue tunic belted in leather, a
 * crimson collar, bracers and boots, brown hair over a skin face.
 *
 * Every entry is a capsule (`from`..`to`) or a sphere (`from` alone) along its
 * bone. Order does not matter — the renderer keeps the nearest surface per
 * pixel — so a belt is simply a capsule a hair fatter than the tunic under it,
 * and hair is a sphere set back and up from the face so it wins on the crown
 * and the face wins in front. Turn him round and the same two spheres give the
 * back of his head, with nothing drawn for it.
 */
const SHIRT_SHADE = -0.02;
const TROUSER_SHADE = -0.34;

const ARM: readonly VolumePiece[] = [
  { from: 0, to: 0.45, radius: 1.1, material: "tunic", shade: SHIRT_SHADE },
  { from: 0.45, to: 0.62, radius: 0.9, material: "skin" },
  { from: 0.62, to: 0.88, radius: 1.05, material: "leather" },
  { from: 1, radius: 1.05, material: "skin" },
];

const LEG: readonly VolumePiece[] = [
  { from: 0, to: 0.55, radius: 1.25, radiusEnd: 1.05, material: "tunic", shade: TROUSER_SHADE },
  { from: 0.52, to: 0.97, radius: 1.2, material: "leather" },
  { from: 0.97, radius: 1.1, material: "leather", offset: vec3(0, 0.8, 0.3) },
];

export const HERO_VOLUMES: Readonly<Record<string, readonly VolumePiece[]>> = {
  torso: [
    { from: 0.05, to: 0.32, radius: 2.8, radiusEnd: 2.55, material: "tunic", shade: SHIRT_SHADE - 0.06 },
    { from: 0.3, to: 0.42, radius: 2.68, material: "leather", shade: 0.05 },
    { from: 0.36, radius: 0.75, material: "gold", offset: vec3(0, 2.35, 0) },
    { from: 0.42, to: 0.96, radius: 2.4, radiusEnd: 2.6, material: "tunic", shade: SHIRT_SHADE },
    { from: 0.8, to: 0.87, radius: 2.68, material: "crimson" },
  ],
  head: [
    { from: 0, to: 0.4, radius: 1, material: "skin", shade: -0.2 },
    { from: 1, radius: 3.15, material: "skin", shade: 0.14, offset: vec3(0, 0.7, 0) },
    { from: 1, radius: 3.3, material: "hair", offset: vec3(0, -0.15, 1) },
    { from: 1, radius: 1.35, material: "hair", offset: vec3(0, -2.1, -0.9) },
  ],
  "shoulder-l": [{ from: 1, radius: 1.35, material: "tunic", shade: SHIRT_SHADE }],
  "shoulder-r": [{ from: 1, radius: 1.35, material: "tunic", shade: SHIRT_SHADE }],
  "arm-l": ARM,
  "arm-r": ARM,
  "leg-l": LEG,
  "leg-r": LEG,
};

/** Two dark eyes, a pixel either side of the nose, only ever over skin. */
export const HERO_FACE: FaceSpec = { bone: "head", spacing: 1, drop: 0.7, ink: "hair-0", on: "skin" };

export const HERO_MODEL: RigModel = {
  volumes: HERO_VOLUMES,
  skeleton: HUMANOID_SKELETON,
  basePose: HUMANOID_BASE,
  style: {
    torso: { ink: "bone", thickness: 2 },
    head: { ink: "bone" },
    "shoulder-l": { ink: "bone" },
    "shoulder-r": { ink: "bone" },
    "arm-l": { ink: "bone" },
    "arm-r": { ink: "bone" },
    "hip-l": { ink: "bone" },
    "hip-r": { ink: "bone" },
    "leg-l": { ink: "bone" },
    "leg-r": { ink: "bone" },
  },
  parts: [
    {
      kind: "stamp",
      id: "head-blob",
      bone: "head",
      at: "end",
      mask: HEAD_MASK,
      anchor: { x: 2, y: 2 },
      ink: "bone",
      facing: "both",
    },
    {
      kind: "stamp",
      id: "eye-l",
      bone: "head",
      at: "end",
      mask: EYE_MASK,
      anchor: { x: 0, y: 0 },
      ink: "void",
      facing: "front",
      offset: vec3(-1, EYE_OUT, 0),
    },
    {
      kind: "stamp",
      id: "eye-r",
      bone: "head",
      at: "end",
      mask: EYE_MASK,
      anchor: { x: 0, y: 0 },
      ink: "void",
      facing: "front",
      offset: vec3(1, EYE_OUT, 0),
    },
  ],
};

// ---------------------------------------------------------------------------
// Gear
// ---------------------------------------------------------------------------

/**
 * A sword is a bone: clips key it by name (`sword`) to swing it through 3D,
 * and when a clip ignores it, it extends the sword arm's own direction.
 */
export const SWORD: RigPart = {
  kind: "bone",
  id: "sword",
  bone: { name: "sword", parent: "arm-r", attach: "end", length: 8.5 },
  ink: "cyan",
  volumes: [
    { from: -0.2, radius: 0.8, material: "gold" },
    { from: -0.16, to: 0.08, radius: 0.6, material: "leather" },
    { from: 0.1, radius: 0.62, material: "gold", across: 1.9 },
    { from: 0.15, to: 0.97, radius: 0.82, radiusEnd: 0.62, material: "metal", shade: 0.12 },
  ],
};

/** Where on the sword bone the blade runs — what burns, and what leaves a trail. */
export const BLADE_SPAN = { from: 0.15, to: 1 } as const;

export const HAT: RigPart = {
  kind: "stamp",
  id: "hat",
  bone: "head",
  at: "end",
  mask: maskFromRows(["..###..", ".#####.", "#######"]),
  anchor: { x: 3, y: 4 },
  ink: "magenta",
  facing: "both",
};

/** Armor is a recolor, not new geometry: the silhouette already exists. */
export const ARMOR: RigPart = {
  kind: "reink",
  id: "armor",
  bones: ["torso"],
  ink: "steel",
};

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

/** Breathing: a one-pixel root bob and a slight arm sway. */
export const IDLE: Clip = {
  id: "idle",
  durationMs: 1400,
  loop: true,
  keys: [
    {
      t: 0,
      root: vec3(0, 0, HIP_Z),
      bones: { "arm-l": vec3(-0.9, 0.25, -0.9), "arm-r": vec3(0.9, 0.25, -0.9) },
    },
    {
      t: 0.5,
      root: vec3(0, 0, HIP_Z - 0.7),
      bones: { "arm-l": vec3(-0.8, 0.3, -1), "arm-r": vec3(0.8, 0.3, -1) },
    },
    { t: 1, root: vec3(0, 0, HIP_Z) },
  ],
};

/**
 * Walking happens *along the depth axis*: authored facing the camera, the
 * stride swings each leg through y, so the same clip played at any `yaw`
 * strides the way he is facing - away up the screen, or across it in profile.
 */
export const WALK: Clip = {
  id: "walk",
  durationMs: 640,
  loop: true,
  keys: [
    {
      t: 0,
      root: vec3(0, 0, HIP_Z),
      bones: {
        "leg-l": vec3(0, 0.9, -1),
        "leg-r": vec3(0, -0.9, -1),
        "arm-l": vec3(-0.8, -0.6, -0.9),
        "arm-r": vec3(0.8, 0.6, -0.9),
      },
    },
    { t: 0.25, root: vec3(0, 0, HIP_Z + 1) },
    {
      t: 0.5,
      root: vec3(0, 0, HIP_Z),
      bones: {
        "leg-l": vec3(0, -0.9, -1),
        "leg-r": vec3(0, 0.9, -1),
        "arm-l": vec3(-0.8, 0.6, -0.9),
        "arm-r": vec3(0.8, -0.6, -0.9),
      },
    },
    { t: 0.75, root: vec3(0, 0, HIP_Z + 1) },
    { t: 1, root: vec3(0, 0, HIP_Z) },
  ],
};

/**
 * The swing's beats, as shares of its length: the windup peaks, the blade
 * crosses dead ahead (when a blow lands), and the follow-through is held.
 */
export const SWING_BEATS = { windup: 0.2, contact: 0.45, through: 0.74 } as const;

/**
 * The sword swing: one flat, horizontal cut at chest height. A short coil to
 * his right, then the blade is swept level round his front - right, ahead,
 * left - and held out at his left side before it drops back to guard. About
 * 200° of arc in under 170 ms, most of it in the middle 90.
 *
 * The cut stays in the half circle before him on purpose. Depth runs up and
 * down the screen in this camera, so blade travel *behind* his shoulder draws
 * as a vertical streak; kept in front, the whole sweep is one wide, shallow
 * crescent, and that is what reads as horizontal.
 *
 * The sweep is keyed every ~45° because a key is a straight line between two
 * directions: spaced closer than that, the blade's tip stays on a circle, so
 * the arc is the arc and the trail it leaves is a clean crescent. The sword is
 * keyed apart from the arm, so the blade leads the wrist round the cut.
 */
export const SWING: Clip = {
  id: "swing",
  durationMs: 380,
  loop: false,
  keys: [
    { t: 0, bones: { "arm-r": vec3(0.9, 0.25, -0.9), sword: vec3(0.9, 0.25, -0.9), torso: vec3(0, 0, 1) } },
    {
      // Anticipation: coil to the right, blade level and just behind his side.
      t: SWING_BEATS.windup,
      bones: {
        "arm-r": vec3(0.85, -0.45, 0),
        sword: vec3(0.96, -0.29, 0.05),
        torso: vec3(0.12, -0.12, 1),
      },
    },
    { t: 0.3, bones: { "arm-r": vec3(0.9, 0.45, -0.15), sword: vec3(0.87, 0.5, -0.03) } },
    { t: 0.375, bones: { "arm-r": vec3(0.55, 0.85, -0.2), sword: vec3(0.42, 0.9, -0.05) } },
    {
      // Contact: level and dead ahead, blade ahead of the wrist.
      t: SWING_BEATS.contact,
      bones: {
        "arm-r": vec3(0.15, 1, -0.22),
        sword: vec3(-0.09, 1, -0.06),
        torso: vec3(0, 0.15, 1),
      },
    },
    { t: 0.53, bones: { "arm-r": vec3(-0.25, 0.95, -0.28), sword: vec3(-0.71, 0.71, -0.08) } },
    {
      // Follow-through: carried round to his left side.
      t: 0.64,
      bones: {
        "arm-r": vec3(-0.45, 0.8, -0.35),
        sword: vec3(-1, 0.09, -0.12),
        torso: vec3(-0.12, 0.12, 1),
      },
    },
    {
      // Held a beat as it bleeds off, so the cut reads as finished.
      t: SWING_BEATS.through,
      bones: { "arm-r": vec3(-0.42, 0.78, -0.4), sword: vec3(-1, -0.09, -0.16) },
    },
    {
      // Settle back to guard.
      t: 1,
      bones: { "arm-r": vec3(0.9, 0.25, -0.9), sword: vec3(0.9, 0.25, -0.9), torso: vec3(0, 0, 1) },
    },
  ],
};

/** Both palms pushed toward the camera — the launch pose for a projectile. */
export const CAST: Clip = {
  id: "cast",
  durationMs: 700,
  loop: false,
  keys: [
    { t: 0, bones: { "arm-l": vec3(-0.9, 0.25, -0.9), "arm-r": vec3(0.9, 0.25, -0.9) } },
    {
      // Gather: hands pulled in and up.
      t: 0.35,
      bones: {
        "arm-l": vec3(-0.3, -0.3, 0.4),
        "arm-r": vec3(0.3, -0.3, 0.4),
        torso: vec3(0, -0.15, 1),
      },
    },
    {
      // Release: both arms thrust at the viewer.
      t: 0.55,
      bones: {
        "arm-l": vec3(-0.2, 1, 0.1),
        "arm-r": vec3(0.2, 1, 0.1),
        torso: vec3(0, 0.25, 1),
      },
    },
    {
      t: 1,
      bones: { "arm-l": vec3(-0.9, 0.25, -0.9), "arm-r": vec3(0.9, 0.25, -0.9), torso: vec3(0, 0, 1) },
    },
  ],
};

export const HERO_CLIPS: readonly Clip[] = [IDLE, WALK, SWING, CAST];

/** The hero as the demo dresses it: sword in hand, head uncovered. */
export const HERO_EQUIPPED: RigModel = equip(HERO_MODEL, SWORD);
