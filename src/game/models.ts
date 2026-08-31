/**
 * Authored rigs: the humanoid skeleton, its gear, and its clips.
 *
 * This is the file an agent edits to give a character a new move or a new
 * piece of equipment. A clip is a handful of keyframes of 3D directions; a
 * sword is one gear bone plus a crossguard stamp; a hat is one mask. Nothing
 * here rasterizes — `rig.ts` does that — so everything in this file is data,
 * diffs line by line, and is testable without a canvas.
 *
 * Proportions: the humanoid stands ~16 world pixels tall (one WALL_RISE), so
 * it reads at the same scale as a standing wall block. Feet at z=0; the model
 * anchors at its foot on the ground.
 */

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
const HIP_Z = 6;

export const HUMANOID_SKELETON: SkeletonDef = {
  bones: [
    { name: "torso", parent: null, attach: "end", length: 5 },
    { name: "head", parent: "torso", attach: "end", length: 2 },
    { name: "arm-l", parent: "torso", attach: "end", length: 4 },
    { name: "arm-r", parent: "torso", attach: "end", length: 4 },
    { name: "leg-l", parent: "torso", attach: "start", length: 6 },
    { name: "leg-r", parent: "torso", attach: "start", length: 6 },
  ],
};

export const HUMANOID_BASE: RigPose = {
  root: vec3(0, 0, HIP_Z),
  bones: {
    torso: vec3(0, 0, 1),
    head: vec3(0, 0, 1),
    "arm-l": vec3(-0.9, 0.25, -0.9),
    "arm-r": vec3(0.9, 0.25, -0.9),
    "leg-l": vec3(-0.3, 0, -1),
    "leg-r": vec3(0.3, 0, -1),
  },
};

const HEAD_MASK = maskFromRows([
  ".###.",
  "#####",
  "#####",
  ".###.",
]);

/** Front-only: the one detail that tells front from back, per the contract. */
const EYES_MASK = maskFromRows(["#.#"]);

export const HERO_MODEL: RigModel = {
  skeleton: HUMANOID_SKELETON,
  basePose: HUMANOID_BASE,
  style: {
    torso: { ink: "bone", thickness: 2 },
    head: { ink: "bone" },
    "arm-l": { ink: "bone" },
    "arm-r": { ink: "bone" },
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
      id: "eyes",
      bone: "head",
      at: "end",
      mask: EYES_MASK,
      anchor: { x: 1, y: 0 },
      ink: "void",
      facing: "front",
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
  bone: { name: "sword", parent: "arm-r", attach: "end", length: 6 },
  ink: "cyan",
};

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
 * stride swings each leg through y, so played with `back` facing the same
 * clip walks away up the screen, and `flipX` mirrors it for left/right.
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
        "leg-l": vec3(-0.25, 0.9, -1),
        "leg-r": vec3(0.25, -0.9, -1),
        "arm-l": vec3(-0.8, -0.6, -0.9),
        "arm-r": vec3(0.8, 0.6, -0.9),
      },
    },
    { t: 0.25, root: vec3(0, 0, HIP_Z + 1) },
    {
      t: 0.5,
      root: vec3(0, 0, HIP_Z),
      bones: {
        "leg-l": vec3(-0.25, -0.9, -1),
        "leg-r": vec3(0.25, 0.9, -1),
        "arm-l": vec3(-0.8, 0.6, -0.9),
        "arm-r": vec3(0.8, -0.6, -0.9),
      },
    },
    { t: 0.75, root: vec3(0, 0, HIP_Z + 1) },
    { t: 1, root: vec3(0, 0, HIP_Z) },
  ],
};

/**
 * The sword swing, through all three axes: raised up and *behind* the head
 * (negative y), then swept fast down and across the front (positive y), with
 * an overshoot and settle. The sword bone is keyed independently of the arm
 * so the blade leads the wrist the way a real swing does.
 */
export const SWING: Clip = {
  id: "swing",
  durationMs: 520,
  loop: false,
  keys: [
    { t: 0, bones: { "arm-r": vec3(0.9, 0.25, -0.9) } },
    {
      // Anticipation: wind up high and behind.
      t: 0.3,
      bones: {
        "arm-r": vec3(0.5, -0.7, 0.9),
        sword: vec3(0.3, -0.9, 0.8),
        torso: vec3(-0.15, -0.2, 1),
      },
    },
    {
      // Contact: fast, in front, blade ahead of the wrist.
      t: 0.45,
      bones: {
        "arm-r": vec3(0.7, 1, -0.2),
        sword: vec3(0.3, 1, -0.7),
        torso: vec3(0.15, 0.25, 1),
      },
    },
    {
      // Overshoot past the target line.
      t: 0.6,
      bones: { "arm-r": vec3(0.3, 1, -0.8), sword: vec3(0, 0.9, -1) },
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

/** The hero as the demo dresses it: sword in hand, hat on head. */
export const HERO_EQUIPPED: RigModel = equip(HERO_MODEL, SWORD, HAT);
