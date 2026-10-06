/**
 * The WebGPU backend's uniforms as bytes, laid out exactly as the WGSL structs
 * read them. Every field is a `vec4f`, so there is no alignment rule to get
 * wrong: the struct is a flat run of floats, four to a field, in this order.
 *
 * Per-draw data is not a uniform at all: it is one storage array, `DRAW_FLOATS`
 * a draw, and each draw is issued with its index as `firstInstance`, so the
 * vertex shader finds its own entry by `instance_index`. Two hundred draws
 * share one bind group and one upload a frame.
 */

import type { DrawCall, FrameUniforms } from "../backend";
import { rgb } from "../mesh";
import { DEPTH_FAR, DEPTH_NEAR } from "../placement";
import { lightDirection } from "../sky-light";
import { heroCellOf } from "./waves";

/** Floats in `Frame` (WGSL): eleven `vec4f`. */
export const FRAME_FLOATS = 44;

/** Floats per entry of `draws` (WGSL `Draw`): two `vec4f`. */
export const DRAW_FLOATS = 8;

/**
 * `Frame`, in field order:
 *
 * | Field | x | y | z | w |
 * | --- | --- | --- | --- | --- |
 * | view | width | height | foot x | foot y |
 * | roll | ground top | roll height | knee | atan(rows / knee) |
 * | depthShake | near | far | shake x | shake y |
 * | hero | planet x | planet y | buffer width | buffer height |
 * | lightDir | x | y | z | - |
 * | ambient | r | g | b | - |
 * | haze | r | g | b | - |
 * | shading | sun | shadow strength | daylight | - |
 * | water | level | wetness | rain | seconds |
 * | sim | hero cell x | hero cell y | - | - |
 * | cut | window centre x | centre y | radius x (0: no window) | radius y |
 */
export function packFrame(frame: FrameUniforms, out: Float32Array = new Float32Array(FRAME_FLOATS)): Float32Array {
  const { view, atmosphere, water } = frame;
  const light = lightDirection(atmosphere);
  const ambient = rgb(atmosphere.ambient);
  const haze = rgb(atmosphere.haze);
  out.set([view.width, view.height, view.footX, view.footY], 0);
  out.set([view.layout.groundTop, view.layout.rollHeight, view.knee, view.atanRows], 4);
  out.set([DEPTH_NEAR, DEPTH_FAR, frame.shake.x, frame.shake.y], 8);
  out.set([water.hero[0], water.hero[1], frame.width, frame.height], 12);
  out.set([light[0], light[1], light[2], 0], 16);
  out.set([ambient[0], ambient[1], ambient[2], 0], 20);
  out.set([haze[0], haze[1], haze[2], 0], 24);
  out.set([0.35 + 0.65 * atmosphere.daylight, atmosphere.shadowStrength, atmosphere.daylight, 0], 28);
  out.set([water.level, water.wetness, water.rain, water.seconds], 32);
  out.set([heroCellOf(water.hero[0]), heroCellOf(water.hero[1]), 0, 0], 36);
  const cut = frame.cutaway;
  out.set(cut === undefined ? [0, 0, 0, 1] : [cut.x, cut.y, cut.radiusX, cut.radiusY], 40);
  return out;
}

/** One run of draws, all mirrored (-1) or all not (1). */
export interface DrawList {
  readonly calls: readonly DrawCall[];
  readonly mirror: number;
}

/** Entries the lists need in all. */
export function drawCount(lists: readonly DrawList[]): number {
  return lists.reduce((sum, list) => sum + list.calls.length, 0);
}

/**
 * A frame's draws, list after list in the order the passes issue them, so draw
 * `n` is entry `n` and each list starts where the last ended. Each entry is its
 * offset, the cosine and sine of its turn, and the mirror.
 */
export function packDraws(lists: readonly DrawList[], out?: Float32Array): Float32Array {
  const count = drawCount(lists);
  const target = out !== undefined && out.length >= count * DRAW_FLOATS ? out : new Float32Array(count * DRAW_FLOATS);
  let at = 0;
  for (const { calls, mirror } of lists) {
    for (const call of calls) {
      target.set([call.offset[0], call.offset[1], Math.cos(call.turn), Math.sin(call.turn), mirror, 0, 0, 0], at);
      at += DRAW_FLOATS;
    }
  }
  return target;
}
