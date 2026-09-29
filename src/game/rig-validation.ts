/**
 * Structural checks over rig data: a skeleton, a clip.
 *
 * Split out of `rig.ts` when the volumetric renderer needed room there, and
 * because these are the one part of the rig nobody calls per frame — they run
 * in tests and in the registry's validation, never in the draw loop. `rig.ts`
 * re-exports both, so every existing import still resolves.
 *
 * Types only come back from `rig.ts`, so there is no runtime cycle.
 */

import type { Clip, SkeletonDef } from "./rig";

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

  const declared = new Set<string>();
  for (const bone of skeleton.bones) {
    if (bone.parent !== null && !declared.has(bone.parent)) {
      problems.push(`Bone '${bone.name}' is declared before its parent '${bone.parent}'`);
    }
    declared.add(bone.name);
  }

  return problems;
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
