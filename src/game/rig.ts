/**
 * Skeleton rigs in the pseudo-3D the camera already speaks.
 *
 * A model is a tree of bones. Each bone is a straight limb with a length; a
 * **pose** gives each bone a direction in rig space, and the rig solves joint
 * positions by walking the tree. Rig space is 3D:
 *
 *   - `x`: world pixels to the right (same as screen x),
 *   - `y`: world units toward the viewer — positive is nearer, down the screen,
 *   - `z`: world pixels straight up off the ground.
 *
 * A rig point projects exactly the way the world does (`projection.ts`):
 * `screenX = x`, `screenY = y * DEPTH_RATIO - z`. That is the whole trick that
 * makes animation pseudo-3D rather than flat: a sword swing keyed through
 * negative y goes *behind* the character, and the same clip played with the
 * `back` facing plays away from the camera by negating y. At 1-bit resolution
 * an arm is three pixels, so the projection's quantization is the style, not a
 * loss.
 *
 * Clips are sparse keyframes, sampled **per channel**: a clip that keys only
 * the sword arm leaves every other bone at the model's base pose. That is what
 * makes clips composable enough for an agent to write by hand — a new attack
 * is four or five lines of directions, not a redraw.
 *
 * Facing is two views, not four: `front` faces the camera and `back` faces
 * away (y negated, front-only detail like eyes dropped). Left/right is a
 * mirror flip at render time, exactly as the art contract prescribes.
 */

import {
  mirrorMask,
  stampMask,
  strokeLine,
  type InkId,
  type Mask,
  type PixelCloud,
} from "./ink";
import { DEPTH_RATIO } from "./projection";

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function scaleToLength(direction: Vec3, length: number): Vec3 {
  const magnitude = Math.hypot(direction.x, direction.y, direction.z);
  if (magnitude < 1e-6) {
    // A zero direction (or two opposed keys meeting mid-lerp) collapses the
    // limb to a point rather than crashing the render loop.
    return ZERO;
  }
  const factor = length / magnitude;
  return { x: direction.x * factor, y: direction.y * factor, z: direction.z * factor };
}

export interface BoneDef {
  readonly name: string;
  /** null for the root bone. */
  readonly parent: string | null;
  /** Which end of the parent this bone hangs from. Root bones ignore it. */
  readonly attach: "start" | "end";
  /** Limb length in world pixels. The pose's direction is normalized to it. */
  readonly length: number;
}

export interface SkeletonDef {
  readonly bones: readonly BoneDef[];
}

/** Structural problems, all at once, in registry-validator style. */
export function validateSkeleton(skeleton: SkeletonDef): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  let roots = 0;

  for (const bone of skeleton.bones) {
    if (names.has(bone.name)) {
      problems.push(`Duplicate bone '${bone.name}'`);
    }
    names.add(bone.name);
    if (bone.length <= 0) {
      problems.push(`Bone '${bone.name}' has non-positive length`);
    }
    if (bone.parent === null) {
      roots += 1;
    }
  }

  for (const bone of skeleton.bones) {
    if (bone.parent !== null && !names.has(bone.parent)) {
      problems.push(`Bone '${bone.name}' hangs from unknown parent '${bone.parent}'`);
    }
  }
  if (roots !== 1) {
    problems.push(`Skeleton has ${roots} root bones; expected exactly 1`);
  }

  // Bones must be declared parent-first, which is also the solve order.
  const declared = new Set<string>();
  for (const bone of skeleton.bones) {
    if (bone.parent !== null && !declared.has(bone.parent)) {
      problems.push(`Bone '${bone.name}' is declared before its parent '${bone.parent}'`);
    }
    declared.add(bone.name);
  }

  return problems;
}

/**
 * A pose: where the root sits, and which way every bone points.
 *
 * Directions need not be unit vectors — only the direction is used, scaled to
 * the bone's length — so keyframes can be written in round numbers.
 */
export interface RigPose {
  readonly root: Vec3;
  readonly bones: Readonly<Record<string, Vec3>>;
}

export interface BoneSegment {
  readonly start: Vec3;
  readonly end: Vec3;
}

export type SolvedPose = Readonly<Record<string, BoneSegment>>;

/**
 * Walk the tree and place every joint, in rig space.
 *
 * A bone missing from the pose keeps the fallback's direction; a bone missing
 * from both is a defect and throws, because a silently skipped limb is exactly
 * the invisible failure the lab exists to prevent.
 */
export function solvePose(
  skeleton: SkeletonDef,
  pose: RigPose,
  fallback?: RigPose,
): Record<string, BoneSegment> {
  const solved: Record<string, BoneSegment> = {};

  for (const bone of skeleton.bones) {
    const direction = pose.bones[bone.name] ?? fallback?.bones[bone.name];
    if (direction === undefined) {
      throw new Error(`No direction for bone '${bone.name}' in pose or fallback`);
    }

    let start: Vec3;
    if (bone.parent === null) {
      start = pose.root;
    } else {
      const parent = solved[bone.parent];
      if (parent === undefined) {
        throw new Error(`Bone '${bone.name}' solved before its parent '${bone.parent}'`);
      }
      start = bone.attach === "start" ? parent.start : parent.end;
    }

    const reach = scaleToLength(direction, bone.length);
    solved[bone.name] = {
      start,
      end: { x: start.x + reach.x, y: start.y + reach.y, z: start.z + reach.z },
    };
  }

  return solved;
}

/** Rig-space point to screen offset from the model's anchor (its foot). */
export function projectRigPoint(point: Vec3): { readonly x: number; readonly y: number } {
  return { x: Math.round(point.x), y: Math.round(point.y * DEPTH_RATIO - point.z) };
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

export interface Keyframe {
  /** Normalized time, 0..1 inclusive. Keys must be sorted ascending. */
  readonly t: number;
  /** Sparse: only the channels this key moves. */
  readonly bones?: Readonly<Record<string, Vec3>>;
  readonly root?: Vec3;
}

export interface Clip {
  readonly id: string;
  readonly durationMs: number;
  readonly loop: boolean;
  readonly keys: readonly Keyframe[];
}

export function validateClip(clip: Clip, skeleton: SkeletonDef, extraBones: readonly string[] = []): string[] {
  const problems: string[] = [];
  if (clip.durationMs <= 0) {
    problems.push(`Clip '${clip.id}' has non-positive duration`);
  }
  if (clip.keys.length === 0) {
    problems.push(`Clip '${clip.id}' has no keyframes`);
  }

  const known = new Set([...skeleton.bones.map((bone) => bone.name), ...extraBones]);
  let previous = -1;
  for (const key of clip.keys) {
    if (key.t < 0 || key.t > 1) {
      problems.push(`Clip '${clip.id}' key at t=${key.t} is outside 0..1`);
    }
    if (key.t <= previous) {
      problems.push(`Clip '${clip.id}' keys are not strictly ascending at t=${key.t}`);
    }
    previous = key.t;
    for (const name of Object.keys(key.bones ?? {})) {
      if (!known.has(name)) {
        problems.push(`Clip '${clip.id}' keys unknown bone '${name}'`);
      }
    }
  }
  return problems;
}

interface ChannelSample<T> {
  readonly before: { readonly t: number; readonly value: T } | undefined;
  readonly after: { readonly t: number; readonly value: T } | undefined;
}

function channelNeighbours<T>(
  keys: readonly { readonly t: number; readonly value: T }[],
  phase: number,
): ChannelSample<T> {
  let before: { t: number; value: T } | undefined;
  let after: { t: number; value: T } | undefined;
  for (const key of keys) {
    if (key.t <= phase) {
      before = key;
    } else {
      after ??= key;
    }
  }
  return { before, after };
}

function sampleChannel<T>(
  keys: readonly { readonly t: number; readonly value: T }[],
  phase: number,
  loop: boolean,
  mix: (a: T, b: T, t: number) => T,
): T | undefined {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (first === undefined || last === undefined) {
    return undefined;
  }

  const { before, after } = channelNeighbours(keys, phase);
  if (before === undefined) {
    // Before the first key. Looping wraps from the last key; a one-shot holds.
    if (!loop || keys.length === 1) {
      return first.value;
    }
    const span = first.t + 1 - last.t;
    return span <= 0 ? first.value : mix(last.value, first.value, (phase + 1 - last.t) / span);
  }
  if (after === undefined) {
    if (!loop || keys.length === 1) {
      return last.value;
    }
    const span = first.t + 1 - last.t;
    return span <= 0 ? last.value : mix(last.value, first.value, (phase - last.t) / span);
  }

  const span = after.t - before.t;
  return span <= 0 ? before.value : mix(before.value, after.value, (phase - before.t) / span);
}

/**
 * Sample a clip at a wall-clock time, filling unkeyed channels from `base`.
 *
 * Looping clips wrap; one-shots clamp to their last key and stay there, which
 * is what lets a scene hold the final pose of a swing while it decides what to
 * play next.
 */
export function samplePose(clip: Clip, base: RigPose, timeMs: number): RigPose {
  const raw = timeMs / clip.durationMs;
  const phase = clip.loop ? ((raw % 1) + 1) % 1 : Math.min(Math.max(raw, 0), 1);

  const boneNames = new Set<string>(Object.keys(base.bones));
  for (const key of clip.keys) {
    for (const name of Object.keys(key.bones ?? {})) {
      boneNames.add(name);
    }
  }

  const bones: Record<string, Vec3> = {};
  for (const name of boneNames) {
    const channel = clip.keys
      .filter((key) => key.bones?.[name] !== undefined)
      .map((key) => ({ t: key.t, value: key.bones?.[name] as Vec3 }));
    bones[name] =
      sampleChannel(channel, phase, clip.loop, lerpVec3) ?? base.bones[name] ?? ZERO;
  }

  const rootChannel = clip.keys
    .filter((key) => key.root !== undefined)
    .map((key) => ({ t: key.t, value: key.root as Vec3 }));
  const root = sampleChannel(rootChannel, phase, clip.loop, lerpVec3) ?? base.root;

  return { root, bones };
}

// ---------------------------------------------------------------------------
// Models: a skeleton dressed in inks and modular parts
// ---------------------------------------------------------------------------

export type Facing = "front" | "back";

export interface BoneStyle {
  readonly ink: InkId;
  readonly thickness?: number;
}

/**
 * Modular gear. Three kinds cover everything so far:
 *
 *  - `stamp`: a mask pinned to a joint — a head, a hat, eyes. `facing` limits
 *    it to one view; eyes are `front`, a cloak knot would be `back`.
 *  - `bone`: gear that *animates* — a sword, a staff. It joins the skeleton as
 *    a real bone, so clips key it by name like any limb. Unkeyed, it extends
 *    its parent's direction, which is why a sword tracks the arm for free.
 *  - `reink`: armor as a recolor of existing limbs, no new geometry.
 */
export type RigPart =
  | {
      readonly kind: "stamp";
      readonly id: string;
      readonly bone: string;
      readonly at: "start" | "end";
      readonly mask: Mask;
      /** Which mask pixel lands on the joint. */
      readonly anchor: { readonly x: number; readonly y: number };
      readonly ink: InkId;
      readonly facing?: Facing | "both";
    }
  | {
      readonly kind: "bone";
      readonly id: string;
      readonly bone: BoneDef;
      readonly ink: InkId;
      readonly thickness?: number;
      /** Fallback direction when no clip keys it. Omitted = extend the parent. */
      readonly direction?: Vec3;
    }
  | {
      readonly kind: "reink";
      readonly id: string;
      readonly bones: readonly string[];
      readonly ink: InkId;
    };

export interface RigModel {
  readonly skeleton: SkeletonDef;
  readonly basePose: RigPose;
  readonly style: Readonly<Record<string, BoneStyle>>;
  readonly parts: readonly RigPart[];
}

/** A new model with more gear on it. The base model is untouched. */
export function equip(model: RigModel, ...parts: readonly RigPart[]): RigModel {
  return { ...model, parts: [...model.parts, ...parts] };
}

export function partBoneNames(model: RigModel): string[] {
  return model.parts.flatMap((part) => (part.kind === "bone" ? [part.bone.name] : []));
}

export function validateModel(model: RigModel): string[] {
  const problems = validateSkeleton(effectiveSkeleton(model));
  for (const bone of model.skeleton.bones) {
    if (model.style[bone.name] === undefined) {
      problems.push(`Bone '${bone.name}' has no style`);
    }
    if (model.basePose.bones[bone.name] === undefined) {
      problems.push(`Bone '${bone.name}' has no base direction`);
    }
  }
  const boneNames = new Set(model.skeleton.bones.map((bone) => bone.name));
  for (const part of model.parts) {
    const target = part.kind === "bone" ? part.bone.parent : undefined;
    if (part.kind === "stamp" && !boneNames.has(part.bone)) {
      problems.push(`Stamp '${part.id}' targets unknown bone '${part.bone}'`);
    }
    if (part.kind === "bone" && target !== null && target !== undefined && !boneNames.has(target)) {
      problems.push(`Gear bone '${part.id}' hangs from unknown bone '${String(target)}'`);
    }
    if (part.kind === "reink") {
      for (const name of part.bones) {
        if (!boneNames.has(name)) {
          problems.push(`Reink '${part.id}' targets unknown bone '${name}'`);
        }
      }
    }
  }
  return problems;
}

/** The skeleton plus every equipped gear bone, in solve order. */
export function effectiveSkeleton(model: RigModel): SkeletonDef {
  const gearBones = model.parts.flatMap((part) => (part.kind === "bone" ? [part.bone] : []));
  return { bones: [...model.skeleton.bones, ...gearBones] };
}

export interface RenderOptions {
  readonly facing?: Facing;
  /** Mirror left/right. Applied after facing. */
  readonly flipX?: boolean;
}

function facingPose(pose: RigPose, facing: Facing, flipX: boolean): RigPose {
  if (facing === "front" && !flipX) {
    return pose;
  }
  const ySign = facing === "back" ? -1 : 1;
  const xSign = flipX ? -1 : 1;
  const bones: Record<string, Vec3> = {};
  for (const [name, direction] of Object.entries(pose.bones)) {
    bones[name] = { x: direction.x * xSign, y: direction.y * ySign, z: direction.z };
  }
  return {
    root: { x: pose.root.x * xSign, y: pose.root.y * ySign, z: pose.root.z },
    bones,
  };
}

/**
 * Flatten a posed model to a pixel cloud anchored at its foot (0, 0).
 *
 * Draw order is by limb depth — far limbs first — so the near arm overwrites
 * the torso the way a painter would layer it. With `back` facing, front-only
 * stamps vanish and depth-keyed motion plays away from the camera; `flipX`
 * mirrors the whole model including stamp masks.
 */
export function renderModel(
  model: RigModel,
  pose: RigPose,
  options: RenderOptions = {},
): PixelCloud {
  const facing = options.facing ?? "front";
  const flipX = options.flipX ?? false;

  const skeleton = effectiveSkeleton(model);
  const oriented = facingPose(pose, facing, flipX);
  const base = facingPose(model.basePose, facing, flipX);

  // Gear bones without a keyed or default direction extend their parent.
  const withGearDefaults: RigPose = {
    root: oriented.root,
    bones: { ...gearDefaults(model, oriented, base, facing, flipX), ...oriented.bones },
  };
  const solved = solvePose(skeleton, withGearDefaults, base);

  const styles: Record<string, BoneStyle> = { ...model.style };
  for (const part of model.parts) {
    if (part.kind === "bone") {
      styles[part.bone.name] = { ink: part.ink, thickness: part.thickness };
    }
    if (part.kind === "reink") {
      for (const name of part.bones) {
        const existing = styles[name];
        if (existing !== undefined) {
          styles[name] = { ...existing, ink: part.ink };
        }
      }
    }
  }

  interface Drawable {
    readonly depth: number;
    readonly draw: (cloud: PixelCloud) => void;
  }
  const drawables: Drawable[] = [];

  for (const bone of skeleton.bones) {
    const segment = solved[bone.name];
    const style = styles[bone.name];
    if (segment === undefined || style === undefined) {
      continue;
    }
    const from = projectRigPoint(segment.start);
    const to = projectRigPoint(segment.end);
    drawables.push({
      depth: (segment.start.y + segment.end.y) / 2,
      draw: (cloud) =>
        strokeLine(cloud, from.x, from.y, to.x, to.y, style.ink, style.thickness ?? 1),
    });
  }

  for (const part of model.parts) {
    if (part.kind !== "stamp") {
      continue;
    }
    const visible = part.facing === undefined || part.facing === "both" || part.facing === facing;
    if (!visible) {
      continue;
    }
    const segment = solved[part.bone];
    if (segment === undefined) {
      continue;
    }
    const joint = part.at === "start" ? segment.start : segment.end;
    const at = projectRigPoint(joint);
    const mask = flipX ? mirrorMask(part.mask) : part.mask;
    const anchorX = flipX ? part.mask.width - 1 - part.anchor.x : part.anchor.x;
    drawables.push({
      // Nudged nearer than the joint's own limb so a head stamp sits on top
      // of the neck stroke rather than under it.
      depth: joint.y + 0.01,
      draw: (cloud) => stampMask(cloud, mask, at.x - anchorX, at.y - part.anchor.y, part.ink),
    });
  }

  drawables.sort((a, b) => a.depth - b.depth);
  const cloud: PixelCloud = [];
  for (const drawable of drawables) {
    drawable.draw(cloud);
  }
  return cloud;
}

function gearDefaults(
  model: RigModel,
  oriented: RigPose,
  base: RigPose,
  facing: Facing,
  flipX: boolean,
): Record<string, Vec3> {
  const defaults: Record<string, Vec3> = {};
  for (const part of model.parts) {
    if (part.kind !== "bone") {
      continue;
    }
    if (part.direction !== undefined) {
      const sign = { y: facing === "back" ? -1 : 1, x: flipX ? -1 : 1 };
      defaults[part.bone.name] = {
        x: part.direction.x * sign.x,
        y: part.direction.y * sign.y,
        z: part.direction.z,
      };
      continue;
    }
    const parent = part.bone.parent;
    if (parent !== null) {
      const inherited = oriented.bones[parent] ?? base.bones[parent];
      if (inherited !== undefined) {
        defaults[part.bone.name] = inherited;
      }
    }
  }
  return defaults;
}
