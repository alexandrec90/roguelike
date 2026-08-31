/**
 * Flattening rig clips into the text-sprite frames the lab and the texture
 * pipeline already speak.
 *
 * The game renders rigs live, pixel by pixel; the asset lab and the registry
 * want fixed frame lists. This module is that bridge: sample a clip at N
 * times, flatten each pose to a sprite in one shared frame box, and the rest
 * of the pipeline cannot tell rig art from hand-drawn art.
 */

import { cloudToSprite, type CloudFrame, type PixelCloud } from "./ink";
import type { PixelSpriteSource } from "./pixel-art";
import { renderModel, samplePose, type Clip, type RenderOptions, type RigModel } from "./rig";
import { meltCloud } from "./transforms";

/**
 * One frame box for every humanoid-scale rig sprite: room for a raised sword
 * above and a two-row melt puddle below, foot anchored at (14, 24).
 */
export const RIG_FRAME: CloudFrame = { width: 28, height: 28, originX: 14, originY: 24 };

export interface SampleOptions extends RenderOptions {
  readonly frame?: CloudFrame;
  /** Post-process each cloud before it flattens — a transform, a tint pass. */
  readonly mapCloud?: (cloud: PixelCloud, index: number, count: number) => PixelCloud;
}

/**
 * Sample `count` frames of a clip. Looping clips sample [0, duration) so the
 * last frame is not a duplicate of the first; one-shots sample the closed
 * interval so the settle pose is the final frame.
 */
export function sampleClipFrames(
  model: RigModel,
  clip: Clip,
  count: number,
  options: SampleOptions = {},
): PixelSpriteSource[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Frame count must be a positive integer");
  }
  const frame = options.frame ?? RIG_FRAME;

  return Array.from({ length: count }, (_unused, index) => {
    const denominator = clip.loop ? count : Math.max(count - 1, 1);
    const timeMs = (index / denominator) * clip.durationMs;
    const pose = samplePose(clip, model.basePose, timeMs);
    let cloud = renderModel(model, pose, options);
    if (options.mapCloud !== undefined) {
      cloud = options.mapCloud(cloud, index, count);
    }
    return cloudToSprite(cloud, frame);
  });
}

/** The base pose melting to a puddle across `count` frames. */
export function sampleMeltFrames(
  model: RigModel,
  count: number,
  seed: number,
  options: SampleOptions = {},
): PixelSpriteSource[] {
  const frame = options.frame ?? RIG_FRAME;
  return Array.from({ length: count }, (_unused, index) => {
    const progress = index / Math.max(count - 1, 1);
    const cloud = renderModel(model, model.basePose, options);
    return cloudToSprite(meltCloud(cloud, progress, seed), frame);
  });
}
