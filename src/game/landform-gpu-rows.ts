/**
 * Where the GPU march's picture is cut into depth slices, worked out without
 * looking at the picture: which rows the landforms in view can show and a
 * rectangle sure to hold each, how those rows merge into as few slices as the
 * display list allows, and where each slice sits in the packed atlas the slice
 * images crop from.
 *
 * Nothing here reads a pixel back from the GPU - every bound comes from the
 * footprint, the projection and each landform's radial profile - so the CPU
 * can place the slices on the frame the GPU draws them.
 *
 * Pure and renderer-free.
 */

import { projectDepth, type CameraFrame } from "./camera";
import type { LandformView } from "./landform-frame";
import type { LandformField } from "./landforms";
import { rowAtFoot, TILE_DEPTH, TILE_WIDTH } from "./projection";

/** Rows of the packed slice atlas; the groups' rectangles are stacked down it. */
export const ATLAS_ROWS = 2048;

/**
 * The tallest a landform stands at or beyond each distance from its centre, in
 * pixels, every `RADIAL_STEP` tiles out: `profile[i]` bounds every height at a
 * distance of at least `i * RADIAL_STEP`. A mountain is tallest in the middle,
 * so this is what lets a row on its flank know it can never stand as high as
 * the peak.
 */
export const RADIAL_STEP = 0.25;

const PROFILES = new WeakMap<LandformField, Float32Array>();

export function radialProfile(field: LandformField): Float32Array {
  const known = PROFILES.get(field);
  if (known !== undefined) {
    return known;
  }
  const buckets = Math.ceil((field.half * Math.SQRT2) / RADIAL_STEP) + 2;
  const profile = new Float32Array(buckets);
  for (let j = 0; j < field.size; j += 1) {
    for (let i = 0; i < field.size; i += 1) {
      const r = Math.hypot(i / field.res - field.half, j / field.res - field.half);
      // A bilinear read between samples can be as tall as the tallest of the
      // four, the nearest of which is up to a sample's diagonal closer in.
      const bucket = Math.max(0, Math.floor((r + Math.SQRT2 / field.res) / RADIAL_STEP));
      const at = Math.min(bucket, buckets - 1);
      profile[at] = Math.max(profile[at] ?? 0, field.heights[j * field.size + i] ?? 0);
    }
  }
  for (let index = buckets - 2; index >= 0; index -= 1) {
    profile[index] = Math.max(profile[index] ?? 0, profile[index + 1] ?? 0);
  }
  PROFILES.set(field, profile);
  return profile;
}

/** The radial bound at a distance, tiles. */
function heightBeyond(profile: Float32Array, r: number): number {
  const index = Math.min(Math.max(0, Math.floor(r / RADIAL_STEP)), profile.length - 1);
  return profile[index] ?? 0;
}

/** A depth row's slice: the rectangle on screen its pixels can occupy. */
export interface RowRect {
  readonly row: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Every row the landforms in view can show, and a rectangle sure to hold all
 * of that row's pixels.
 *
 * A row is one tile of depth (`step.row` is the affine row of the march's own
 * ground). Its rectangle runs across the footprint's chord at that depth, from
 * the ground at its near edge up to the tallest the land can stand that close
 * to the centre.
 */
export function rowRects(
  frame: CameraFrame,
  views: readonly LandformView[],
  width: number,
  height: number,
): RowRect[] {
  const byRow = new Map<number, { left: number; top: number; right: number; bottom: number }>();
  for (const view of views) {
    const { field } = view;
    const near = view.centreY - field.half;
    const far = view.centreY + field.half;
    for (let row = rowAtDepth(frame, near) + 1; row >= rowAtDepth(frame, far) - 1; row -= 1) {
      const [rowNear, rowFar] = depthsOfRow(frame, row);
      const from = Math.max(rowNear, near);
      const to = Math.min(rowFar, far);
      if (from > to) {
        continue;
      }
      const box = rowBox(frame, view, from, to, width, height);
      if (box === undefined) {
        continue;
      }
      const held = byRow.get(row);
      byRow.set(row, held === undefined ? box : union(held, box));
    }
  }
  return [...byRow].map(([row, box]) => ({ row, ...box })).sort((a, b) => a.row - b.row);
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

function union(a: Box, b: Box): Box {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/** The march's own row at a local depth: the affine row of the ground there. */
function rowAtDepth(frame: CameraFrame, localY: number): number {
  return Math.round(rowAtFoot(Math.round(frame.footY - (localY - frame.phaseY) * TILE_DEPTH), frame.groundTop));
}

/** The local depths whose march row is `row`, with half a tile of slack either side. */
function depthsOfRow(frame: CameraFrame, row: number): [number, number] {
  // rowAtFoot(g) = (g - groundTop) / TILE_DEPTH - 1, so row r is ground g about
  // groundTop + (r + 1) * TILE_DEPTH, and g = footY - (y - phaseY) * TILE_DEPTH.
  const centre = frame.phaseY + (frame.footY - (frame.groundTop + (row + 1) * TILE_DEPTH)) / TILE_DEPTH;
  return [centre - 1, centre + 1];
}

function rowBox(
  frame: CameraFrame,
  view: LandformView,
  from: number,
  to: number,
  width: number,
  height: number,
): Box | undefined {
  const outer = view.field.landform.radius + 1;
  const nearDepth = projectDepth(frame, from);
  const farDepth = projectDepth(frame, to);
  const lowDy = from - view.centreY;
  const highDy = to - view.centreY;
  const closest = lowDy <= 0 && highDy >= 0 ? 0 : Math.min(Math.abs(lowDy), Math.abs(highDy));
  const chord = Math.sqrt(Math.max(0, outer * outer - closest * closest));
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const depth of [nearDepth, farDepth]) {
    const across = TILE_WIDTH * depth.scale;
    const centre = frame.footX + (view.centreX - frame.phaseX) * across;
    left = Math.min(left, centre - chord * across);
    right = Math.max(right, centre + chord * across);
  }
  const scale = Math.max(nearDepth.scale, farDepth.scale);
  const bottom = Math.min(height, Math.ceil(Math.max(nearDepth.ground, farDepth.ground)) + 2, Math.ceil(nearDepth.clipY) + 2);
  // As tall as the land can stand this close to the centre, not the peak: the
  // flanks of a mountain are rows of low ground under a high summit.
  const tallest = heightBeyond(radialProfile(view.field), closest);
  const top = Math.max(0, Math.floor(Math.min(nearDepth.ground, farDepth.ground) - tallest * scale) - 2);
  const box = {
    left: Math.max(0, Math.floor(left) - 2),
    right: Math.min(width, Math.ceil(right) + 2),
    top,
    bottom,
  };
  return box.left < box.right && box.top < box.bottom ? box : undefined;
}

/** Something standing in the display list, as a slice must sort around it. */
export interface Obstacle extends Box {
  readonly depth: number;
}

/** Rows drawn as one slice: their codes, their rectangle, and the depth they share. */
export interface RowGroup {
  readonly lowCode: number;
  readonly highCode: number;
  readonly rect: RowRect;
  readonly depth: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Rows merged into as few slices as the display list allows.
 *
 * A slice per row is exact and costly: on the HD 530 a hundred of them cost
 * 2.3 ms of CPU (each a draw that breaks the sprite batch) and 2.6 ms of GPU
 * (their rectangles overlap heavily). But two rows only need to be apart if
 * something standing sorts between them and overlaps them on screen - a tree
 * in front of the far row and behind the near one. So rows are taken far to
 * near and a group grows while nothing sorted between its rows overlaps the
 * rows already in it; the group draws at its nearest row's depth.
 *
 * Exact: a row in a group draws later than its own depth, so the only things
 * it can wrongly cover are ones sorted after it and before the group - the
 * very ones checked. Everything sorted before it, or after the group, is drawn
 * in the same order as if it had its own slice.
 */
export function groupRows(
  rects: readonly RowRect[],
  base: number,
  obstacles: readonly Obstacle[],
  depthOf: (row: number) => number,
): RowGroup[] {
  const rows = [...rects].sort((a, b) => a.row - b.row);
  const sorted = [...obstacles].sort((a, b) => a.depth - b.depth);
  const groups: RowGroup[] = [];
  let group: { low: RowRect; high: RowRect; union: RowRect; sealed: boolean } | undefined;
  let cursor = 0;
  const close = (): void => {
    if (group !== undefined) {
      groups.push({
        lowCode: rowCode(group.low.row, base),
        highCode: rowCode(group.high.row, base),
        rect: group.union,
        depth: depthOf(Math.max(group.high.row, base)),
      });
    }
  };
  for (const rect of rows) {
    const depth = depthOf(Math.max(rect.row, base));
    let blocked = false;
    let sealed = false;
    // Everything sorted after the group's nearest row and up to this one. A
    // tie is decided by the display list's own order, which can go either way
    // (a tree is added before the slices, the campfire after), so it is taken
    // the cautious way twice: a tie with this row blocks joining it to the
    // group, and seals it against anything nearer joining it.
    while (cursor < sorted.length && (sorted[cursor] as Obstacle).depth <= depth) {
      const obstacle = sorted[cursor] as Obstacle;
      blocked ||= group !== undefined && overlaps(obstacle, group.union);
      sealed ||= obstacle.depth === depth && overlaps(obstacle, rect);
      cursor += 1;
    }
    if (group === undefined || blocked || group.sealed) {
      close();
      group = { low: rect, high: rect, union: rect, sealed };
      continue;
    }
    group = { low: group.low, high: rect, sealed, union: { row: rect.row, ...union(group.union, rect) } };
  }
  close();
  return groups;
}

/** The farthest row that keeps its own code, given the rows in view: 254 rows fit a byte. */
export function rowBase(rows: readonly number[]): number {
  if (rows.length === 0) {
    return 0;
  }
  const farthest = Math.min(...rows);
  const nearest = Math.max(...rows);
  return Math.max(farthest, nearest - 253);
}

/** A row as the byte the march writes in alpha: 1 for the farthest kept, 0 is reserved for empty. */
export function rowCode(row: number, base: number): number {
  return Math.min(255, Math.max(1, row - base + 1));
}

/** A group of rows and where its band starts in the atlas. */
export interface Band {
  readonly group: RowGroup;
  readonly atlasY: number;
}

/**
 * Stack the groups' rectangles down the atlas, one band each. Should they ever
 * outgrow it, the nearest that do not fit are merged into the last band that
 * does - drawn a little out of order rather than not at all.
 */
export function stackBands(groups: readonly RowGroup[], rows: number = ATLAS_ROWS): Band[] {
  const bands: Band[] = [];
  let atlasY = 0;
  for (const group of groups) {
    const height = group.rect.bottom - group.rect.top;
    const last = bands[bands.length - 1];
    if (atlasY + height <= rows || last === undefined) {
      bands.push({ group, atlasY });
      atlasY += height;
      continue;
    }
    const merged = last.group;
    const rect = { row: group.rect.row, ...union(merged.rect, group.rect) };
    const fits = Math.min(rect.bottom - rect.top, rows - last.atlasY);
    bands[bands.length - 1] = {
      atlasY: last.atlasY,
      group: { ...merged, highCode: group.highCode, depth: group.depth, rect: { ...rect, bottom: rect.top + fits } },
    };
    atlasY = last.atlasY + fits;
  }
  return bands;
}
