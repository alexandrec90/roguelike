/**
 * Drawing landforms, frame by frame: which are in sight, the march over them
 * (`landform-march.ts`), the near render laid over the far one by depth, and
 * the outline that separates one from what stands behind it.
 *
 * The look is flat illustration on purpose (`landform-colour.ts`), and each
 * painted pixel records the affine row of the surface it shows, so the layer
 * can cut the picture into one slice per row and sort each slice with the
 * trees and the hero: a tree behind a mesa is hidden by it, and the hero can
 * walk round a mountain's flank.
 *
 * Pure: a frame, the landforms and the light in, pixels and rows out.
 */

import { projectDepth, type CameraFrame } from "./camera";
import { NO_ROW, type LandformLight, type LandformPixels, type LandformView } from "./landform-frame";
import { LandformPainter, marchSchedule, type Step } from "./landform-march";
import { landformField, planetLandforms } from "./landforms";
import { toLocal, type PlanetPose } from "./planet";
import { TILE_WIDTH } from "./projection";

/** Rows past the field's far edge beyond which a landform barely moves with a stride. */
export const FAR_ROWS = 6;

/**
 * Whether all of a landform is far past the field's edge: there a stride in
 * flight moves it a fraction of a pixel, so it need only be redrawn when the
 * pose changes or a strafe has slid it a whole pixel - not every frame.
 */
export function isFarView(frame: CameraFrame, view: LandformView): boolean {
  return projectDepth(frame, view.centreY - view.field.half).rowsBeyond > FAR_ROWS;
}

/**
 * Lay the two renders into `out`, nearer row winning wherever both cover a
 * pixel. A row is depth, so this is a depth test: the back slopes of a near
 * mountain still go behind a far tower standing beside it. Nothing else can
 * hide a far landform - the flat field in front of one is never above the band
 * it stands in.
 */
export function mergeLandforms(near: LandformPixels, far: LandformPixels, out: LandformPixels): void {
  out.rgba.set(far.rgba);
  out.rows.set(far.rows);
  const extent = out.extent;
  extent.top = out.height;
  extent.bottom = 0;
  extent.farthest = Number.MAX_SAFE_INTEGER;
  for (let y = 0; y < out.height; y += 1) {
    for (let x = 0; x < out.width; x += 1) {
      const index = y * out.width + x;
      const nearRow = near.rows[index] ?? NO_ROW;
      if (nearRow !== NO_ROW && nearRow >= (far.rows[index] ?? NO_ROW)) {
        out.rows[index] = nearRow;
        const at = index * 4;
        out.rgba[at] = near.rgba[at] ?? 0;
        out.rgba[at + 1] = near.rgba[at + 1] ?? 0;
        out.rgba[at + 2] = near.rgba[at + 2] ?? 0;
        out.rgba[at + 3] = near.rgba[at + 3] ?? 0;
      }
      const row = out.rows[index] ?? NO_ROW;
      if (row !== NO_ROW) {
        extent.top = Math.min(extent.top, y);
        extent.bottom = y + 1;
        extent.farthest = Math.min(extent.farthest, row);
      }
    }
  }
}

/** How much an outline darkens the pixel it falls on. */
const OUTLINE = 0.62;

/** Rows of depth between neighbouring pixels that make an edge worth a line: one surface in front of another. */
const EDGE_ROWS = 3;

/** Whether land at a pixel stands against sky, field, or a surface some rows behind it, above or to either side. */
function isEdge(pixels: LandformPixels, x: number, y: number): boolean {
  const { width, rows } = pixels;
  const index = y * width + x;
  const row = rows[index] ?? NO_ROW;
  if (row === NO_ROW) {
    return false;
  }
  // NO_ROW is the most negative row there is, so "behind" covers "nothing there".
  const behind = row - EDGE_ROWS;
  const up = y > 0 ? (rows[index - width] ?? NO_ROW) : NO_ROW;
  const left = x > 0 ? (rows[index - 1] ?? NO_ROW) : row;
  const right = x < width - 1 ? (rows[index + 1] ?? NO_ROW) : row;
  return up < behind || left < behind || right < behind;
}

/**
 * Line the landforms' silhouettes, in place: a pixel whose neighbour above or
 * to either side is sky, field, or a surface some rows behind it is darkened.
 * It is what separates a mountain from the one behind it, and a spire from the
 * meadow, the way the bodies' own outlines do (`outlineCloud`). The foot is
 * left unlined - it stands on the ground, not against it.
 */
export function outlineLandforms(pixels: LandformPixels): void {
  const { width, rgba, extent } = pixels;
  const edges: number[] = [];
  for (let y = extent.top; y < extent.bottom; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isEdge(pixels, x, y)) {
        edges.push(y * width + x);
      }
    }
  }
  for (const index of edges) {
    rgba[index * 4] = (rgba[index * 4] ?? 0) * OUTLINE;
    rgba[index * 4 + 1] = (rgba[index * 4 + 1] ?? 0) * OUTLINE;
    rgba[index * 4 + 2] = (rgba[index * 4 + 2] ?? 0) * OUTLINE;
  }
}

/**
 * The landforms any part of which can show this frame, with their centres in
 * local tiles: any of the footprint in front of the screen's bottom edge or
 * tall enough to rise into it, within the screen's width at their distance,
 * and not sunk wholly behind the horizon. Their grids are built here the first time each is seen.
 */
export function viewsInSight(
  frame: CameraFrame,
  pose: PlanetPose,
  size: { readonly width: number; readonly height: number },
): LandformView[] {
  const views: LandformView[] = [];
  for (const landform of planetLandforms()) {
    const local = toLocal(pose, landform);
    const reach = landform.radius + 1.5;
    const near = projectDepth(frame, local.y - reach);
    const centre = projectDepth(frame, local.y);
    // Its highest pixel stands over its far edge, not its foot: a mesa's top
    // runs back there, two radii up the screen from the near edge.
    const far = projectDepth(frame, local.y + reach);
    if (Math.min(near.ground, far.ground) - landform.height * Math.max(near.scale, far.scale) * 1.4 > size.height) {
      continue;
    }
    if (centre.sink > landform.height * 1.4) {
      continue;
    }
    const across = (Math.abs(local.x - frame.phaseX) - reach) * TILE_WIDTH * Math.min(near.scale, centre.scale);
    if (across > Math.max(frame.footX, size.width - frame.footX)) {
      continue;
    }
    views.push({ field: landformField(landform), centreX: local.x, centreY: local.y });
  }
  return views;
}

/**
 * Draw every landform in view into `out`, which is cleared first. Nothing a
 * landform does not cover is touched but the clear.
 */
export function renderLandforms(
  frame: CameraFrame,
  views: readonly LandformView[],
  light: LandformLight,
  out: LandformPixels,
): void {
  out.rgba.fill(0);
  out.rows.fill(NO_ROW);
  if (views.length === 0) {
    return;
  }
  const steps = marchSchedule(frame, views);
  // The highest any wall at or past each step can reach: once a column is
  // painted above it, nothing farther can show and the column stops.
  const highest = new Float64Array(steps.length);
  let reach = Number.POSITIVE_INFINITY;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index] as Step;
    const peak = Math.max(...step.views.map((view) => views[view]?.field.peak ?? 0));
    reach = Math.min(reach, step.ground - peak * step.scale - 1);
    highest[index] = reach;
  }
  const painter = new LandformPainter(frame, views, light, out);
  steps.forEach((step, index) => painter.step(index, step, highest[index] ?? 0));
}
