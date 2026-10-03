/**
 * What the GPU march is handed, as plain numbers: each landform's grid packed
 * into a float atlas, the views as uniform arrays, the march schedule as
 * texels, and which steps each screen column can need.
 *
 * The march itself stays the CPU's: `marchSchedule` decides the depths, near
 * to far, exactly as it does for `renderLandforms`, and the shader walks the
 * same steps per pixel that the painter walks per column
 * (`gpu/landform-shader.ts`). What moves to the GPU is the per-pixel work -
 * thousands of height lookups a column, which is what cost ~5 ms a walking
 * frame on the CPU. Where the picture is cut into depth slices is
 * `landform-gpu-rows.ts`.
 *
 * Pure and renderer-free: numbers in, `Float32Array`s out.
 */

import type { CameraFrame } from "./camera";
import type { LandformView } from "./landform-frame";
import type { Step } from "./landform-march";
import { isRoofed, type LandformField } from "./landforms";
import { TILE_WIDTH } from "./projection";

/** Texels across the field atlas; fields are shelved into it as they are first seen. */
export const FIELD_ATLAS_WIDTH = 1024;
export const FIELD_ATLAS_HEIGHT = 1024;

/** Texels across the schedule texture; a step takes two. */
export const SCHEDULE_WIDTH = 256;

/**
 * The most depths a frame may march: the probe pass is a texture this tall.
 * The start of the planet, twelve landforms in sight, marches 431.
 */
export const MAX_STEPS = 1024;

/** Steps per block of the block-minimum pass. */
export const BLOCK_STEPS = 16;

/**
 * The most landforms one frame draws. The start of the planet already shows
 * twelve, most of them far peaks on the skyline; the view mask is a float, so
 * up to 24 would still be exact.
 */
export const MAX_VIEWS = 16;

/** The landform kinds, as the shader numbers them. */
export const KIND_CODE: Readonly<Record<string, number>> = { mountain: 0, mesa: 1, spire: 2, tower: 3 };

/** Where a field's texels are in the atlas: its grid, then its block maxima to the right. */
export interface FieldSlot {
  readonly x: number;
  readonly y: number;
}

/**
 * A field as atlas texels, `size + blocks` wide and `size` tall, four floats a
 * texel: height, normal x, normal y, and material and detail folded into one
 * (`material * 4 + detail + 2`, detail being within ±1). The block maxima sit
 * to the right of the grid, one per texel in the red channel.
 */
export function packField(field: LandformField): { width: number; height: number; data: Float32Array } {
  const width = field.size + field.blocks;
  const height = field.size;
  const data = new Float32Array(width * height * 4);
  for (let j = 0; j < field.size; j += 1) {
    for (let i = 0; i < field.size; i += 1) {
      const from = j * field.size + i;
      const to = (j * width + i) * 4;
      data[to] = field.heights[from] ?? 0;
      data[to + 1] = field.normalX[from] ?? 0;
      data[to + 2] = field.normalY[from] ?? 0;
      data[to + 3] = (field.materials[from] ?? 0) * 4 + Math.max(-1.99, Math.min(1.99, field.detail[from] ?? 0)) + 2;
    }
  }
  for (let bj = 0; bj < field.blocks; bj += 1) {
    for (let bi = 0; bi < field.blocks; bi += 1) {
      data[(bj * width + field.size + bi) * 4] = field.blockMax[bj * field.blocks + bi] ?? 0;
    }
  }
  return { width, height, data };
}

/** Shelves fields into the atlas, once each, and remembers where. */
export class FieldAtlas {
  private readonly slots = new Map<string, FieldSlot>();
  private shelfX = 0;
  private shelfY = 0;
  private shelfHeight = 0;

  constructor(
    private readonly width = FIELD_ATLAS_WIDTH,
    private readonly height = FIELD_ATLAS_HEIGHT,
  ) {}

  /** Where the field is, and whether it was just placed (and so still needs uploading). */
  place(field: LandformField): { readonly slot: FieldSlot; readonly fresh: boolean } {
    const known = this.slots.get(field.landform.id);
    if (known !== undefined) {
      return { slot: known, fresh: false };
    }
    const w = field.size + field.blocks;
    const h = field.size;
    if (this.shelfX + w > this.width) {
      this.shelfY += this.shelfHeight;
      this.shelfX = 0;
      this.shelfHeight = 0;
    }
    if (this.shelfY + h > this.height) {
      throw new Error(`Landform field atlas is full at '${field.landform.id}'`);
    }
    const slot = { x: this.shelfX, y: this.shelfY };
    this.shelfX += w;
    this.shelfHeight = Math.max(this.shelfHeight, h);
    this.slots.set(field.landform.id, slot);
    return { slot, fresh: true };
  }
}

/**
 * The views as five `vec4`s each, for the shader's uniform arrays:
 *
 * | Array | x | y | z | w |
 * | --- | --- | --- | --- | --- |
 * | `a` | centre x | centre y | half | res |
 * | `b` | atlas x | atlas y | size | peak |
 * | `c` | kind | radius | height | seed |
 * | `d` | blocks | roofed | far | 0 |
 * | `e` | seed mod 2π | seed mod 7 | window bays | 0 |
 *
 * `e` is worked out here in float64: a 24-bit seed added to an angle in
 * float32 loses the angle, so the shader is handed the remainder instead.
 */
export function viewUniforms(
  views: readonly LandformView[],
  slots: readonly FieldSlot[],
  far: readonly boolean[],
): { a: Float32Array; b: Float32Array; c: Float32Array; d: Float32Array; e: Float32Array } {
  const a = new Float32Array(MAX_VIEWS * 4);
  const b = new Float32Array(MAX_VIEWS * 4);
  const c = new Float32Array(MAX_VIEWS * 4);
  const d = new Float32Array(MAX_VIEWS * 4);
  const e = new Float32Array(MAX_VIEWS * 4);
  views.slice(0, MAX_VIEWS).forEach((view, index) => {
    const { field } = view;
    const { landform } = field;
    const slot = slots[index] ?? { x: 0, y: 0 };
    a.set([view.centreX, view.centreY, field.half, field.res], index * 4);
    b.set([slot.x, slot.y, field.size, field.peak], index * 4);
    c.set([KIND_CODE[landform.kind] ?? 0, landform.radius, landform.height, landform.seed], index * 4);
    d.set([field.blocks, isRoofed(landform) ? 1 : 0, far[index] === true ? 1 : 0, 0], index * 4);
    e.set([landform.seed % (Math.PI * 2), landform.seed % 7, 4 * Math.round(2 * landform.radius) * 1.5, 0], index * 4);
  });
  return { a, b, c, d, e };
}

/**
 * The schedule as texels, two a step:
 * `(y, ground, scale, clipY)` then `(fog, row, view mask, highest)`.
 * `highest` is the suffix minimum the CPU march breaks on: nothing at or past
 * the step can paint above it.
 */
export function scheduleTexels(steps: readonly Step[], highest: ArrayLike<number>): Float32Array {
  const count = Math.min(steps.length, MAX_STEPS);
  const rows = Math.max(1, Math.ceil((count * 2) / SCHEDULE_WIDTH));
  const data = new Float32Array(SCHEDULE_WIDTH * rows * 4);
  for (let index = 0; index < count; index += 1) {
    const step = steps[index] as Step;
    const mask = step.views.reduce((bits, view) => (view < MAX_VIEWS ? bits | (1 << view) : bits), 0);
    // clipY is infinite this side of the horizon; a float texture holds a large number better.
    const clip = Number.isFinite(step.clipY) ? step.clipY : 1e6;
    data.set([step.y, step.ground, step.scale, clip, step.fog, step.row, mask, highest[index] ?? 0], index * 8);
  }
  return data;
}

/**
 * The highest scanline anything at or past each step can paint: the CPU
 * march's early-out, computed the same way.
 */
export function highestReach(steps: readonly Step[], views: readonly LandformView[]): Float64Array {
  const highest = new Float64Array(steps.length);
  let reach = Number.POSITIVE_INFINITY;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index] as Step;
    const peak = Math.max(...step.views.map((view) => views[view]?.field.peak ?? 0));
    reach = Math.min(reach, step.ground - peak * step.scale - 1);
    highest[index] = reach;
  }
  return highest;
}

/**
 * Per screen column: the first and last step any landform covers it at, a
 * scanline nothing can paint above (unused, so -1e6), and which views ever
 * cover it - `(first, last, top, mask)`. The march visits only a column's own
 * steps, and a column no landform covers is empty at once.
 *
 * Exact: a step outside the range has no landform over the column, so it would
 * paint nothing and change no column state. The mask may name a view that
 * covers the column at no step - it is only a filter, and the probe's own
 * chord test has the last word.
 *
 * One landform's columns at consecutive steps are one interval, widening to its
 * middle and narrowing past it, so only the columns an interval newly reaches
 * are visited, from each end: the whole is linear in steps plus columns. (The
 * first version visited every column of every step and cost 2.7 ms a walking
 * frame on its own.)
 */
export function columnBounds(
  frame: CameraFrame,
  views: readonly LandformView[],
  steps: readonly Step[],
  width: number,
): Float32Array {
  const first = new Int32Array(width).fill(steps.length);
  const last = new Int32Array(width).fill(-1);
  const mask = new Int32Array(width);
  views.slice(0, MAX_VIEWS).forEach((view, viewIndex) => {
    const spans: { index: number; left: number; right: number }[] = [];
    steps.forEach((step, index) => {
      if (!step.views.includes(viewIndex)) {
        return;
      }
      const across = TILE_WIDTH * step.scale;
      const centre = frame.footX + (view.centreX - frame.phaseX) * across;
      const dy = step.y - view.centreY;
      const outer = view.field.landform.radius + 1;
      const chord = Math.sqrt(Math.max(0, outer * outer - dy * dy));
      const left = Math.max(0, Math.floor(centre - chord * across));
      const right = Math.min(width - 1, Math.ceil(centre + chord * across));
      if (left <= right) {
        spans.push({ index, left, right });
      }
    });
    sweep(spans, first, (x, index) => index < (first[x] ?? 0));
    sweep([...spans].reverse(), last, (x, index) => index > (last[x] ?? 0));
    const lo = Math.min(...spans.map((span) => span.left));
    const hi = Math.max(...spans.map((span) => span.right));
    for (let x = lo; x <= hi; x += 1) {
      mask[x] = (mask[x] ?? 0) | (1 << viewIndex);
    }
  });
  const data = new Float32Array(width * 4);
  for (let x = 0; x < width; x += 1) {
    const covered = (last[x] ?? -1) >= 0;
    data.set(covered ? [first[x] ?? 0, last[x] ?? 0, -1e6, mask[x] ?? 0] : [0, -1, -1e6, 0], x * 4);
  }
  return data;
}

/**
 * Walk one landform's spans in order, recording each column at the first span
 * to reach it: only columns outside everything reached so far are new. What
 * has been reached is kept as one interval, and a span that jumps past it
 * claims the gap too - a column given a step earlier than its own (or later,
 * walking backward) only makes the march visit a step where nothing is there,
 * never miss one where something is.
 */
function sweep(
  spans: readonly { index: number; left: number; right: number }[],
  into: Int32Array,
  better: (x: number, index: number) => boolean,
): void {
  let reachedLeft = Number.POSITIVE_INFINITY;
  let reachedRight = Number.NEGATIVE_INFINITY;
  const claim = (from: number, to: number, index: number): void => {
    for (let x = from; x <= to; x += 1) {
      if (better(x, index)) into[x] = index;
    }
  };
  for (const { index, left, right } of spans) {
    if (reachedLeft > reachedRight) {
      claim(left, right, index);
      reachedLeft = left;
      reachedRight = right;
      continue;
    }
    if (left < reachedLeft) {
      claim(left, reachedLeft - 1, index);
      reachedLeft = left;
    }
    if (right > reachedRight) {
      claim(reachedRight + 1, right, index);
      reachedRight = right;
    }
  }
}
