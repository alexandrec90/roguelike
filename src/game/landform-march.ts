/**
 * The march: every landform in view, walked from near to far one depth at a
 * time, each depth visiting only the screen columns a landform covers there.
 *
 * A screen column is a line on the ground running away from the camera, so
 * walking up it in depth and keeping the highest scanline painted so far is a
 * complete hidden-surface pass: a nearer slope hides a farther peak because it
 * was reached first. Every step asks the one projection the rest of the world
 * uses (`projectDepth`) where the ground is and how large things are there, so
 * a landform is drawn at full size on the field, shrinks up the roll, and sinks
 * foot first behind the horizon line past it - the same path a tree takes,
 * with nothing redrawn and nothing scaled.
 */

import { projectDepth, type CameraFrame } from "./camera";
import type { Rgb } from "./color";
import { ROLL_ROWS, rollLift } from "./horizon";
import { colourOf, RAMPS, SEAM, spanOf, wallMaterial, wrapLevel, type SurfaceDraft } from "./landform-colour";
import {
  bayer,
  cutAway,
  type Cutaway,
  type LandformLight,
  type LandformPixels,
  type LandformView,
} from "./landform-frame";
import { CLIFF, fieldBound, fieldHeight, fieldSample, GRASS, type LandformField } from "./landforms";
import { rowAtFoot, TILE_DEPTH, TILE_WIDTH } from "./projection";
import { HAZE_STEPS, hazeInto, HORIZON_HAZE, rollFog } from "./roll-ground";

/** How much more of the haze the air lends the world past the horizon, at most. */
const FAR_HAZE = 0.82;

/** Rows past the horizon over which the far haze closes in. */
const FAR_HAZE_ROWS = 30;

/** The share of the haze's colour the air lends a thing this far past the field's edge. */
export function landformFog(rowsBeyond: number, rollHeight: number): number {
  if (rowsBeyond <= ROLL_ROWS) {
    return rollFog(rollLift(rowsBeyond, rollHeight));
  }
  return HORIZON_HAZE + (FAR_HAZE - HORIZON_HAZE) * (1 - Math.exp(-(rowsBeyond - ROLL_ROWS) / FAR_HAZE_ROWS));
}

/**
 * Rows past the field's edge over which a landform's cloud shadow fades out.
 * No more than `FAR_ROWS` (`landform-render.ts`): a far view takes no cloud
 * at all, so the fade must be done by then or the shadow would pop.
 */
export const CLOUD_FADE_ROWS = 6;

/** How much of the cloud shadow a surface this far past the field's edge takes, 0..1. */
export function cloudReach(rowsBeyond: number): number {
  return Math.min(Math.max(1 - rowsBeyond / CLOUD_FADE_ROWS, 0), 1);
}

/**
 * Where a surface at depth `localY`, drawn in column `x` at `scale`, reads the
 * cloud tile: the screen point it would have on the flat field, unrolled.
 *
 * On the field that is the pixel itself, so a landform darkens exactly as the
 * ground beside it does. Past the field's edge the roll packs many tiles of
 * depth into each scanline, and the tile - which slides a whole `TILE_DEPTH` a
 * tile walked - would stream over a slope there in stripes; read where the
 * surface really is, the shadow stays on the mountain as the hero walks.
 */
export function cloudPoint(frame: CameraFrame, x: number, localY: number, scale: number): { x: number; y: number } {
  return {
    x: Math.round(frame.footX + (x - frame.footX) / scale),
    y: Math.round(frame.footY - (localY - frame.phaseY) * TILE_DEPTH),
  };
}

/** One depth of the march: the same for every column, so worked out once a frame. */
export interface Step {
  readonly y: number;
  readonly ground: number;
  readonly scale: number;
  readonly clipY: number;
  readonly fog: number;
  readonly row: number;
  /** Indices into the views whose footprint spans this depth. */
  readonly views: readonly number[];
}

/**
 * Finest march, in scanlines of ground per step. Each step paints the whole
 * span it uncovers, so a coarser march leaves no gap - only a slope's tones
 * change a little less often - and two scanlines halves the work of one.
 */
const STEP_SCANLINES = 2;

/**
 * The depths to march, near to far, over every view's footprint and nowhere
 * else. A step moves the ground at most `STEP_SCANLINES`, and passes over no
 * grid sample of the landform it crosses that would land a pixel or more away.
 */
export function marchSchedule(frame: CameraFrame, views: readonly LandformView[]): Step[] {
  const spans = views
    .map((view, index) => ({
      index,
      near: view.centreY - view.field.half,
      far: view.centreY + view.field.half,
      stride: 1 / view.field.res,
    }))
    .sort((a, b) => a.near - b.near);
  const far = spans.reduce((most, span) => Math.max(most, span.far), Number.NEGATIVE_INFINITY);
  const steps: Step[] = [];
  let y = spans[0]?.near ?? 1;
  while (y <= far) {
    const active: number[] = [];
    let finest = 1;
    let nextStart = far + 1;
    for (const span of spans) {
      if (y >= span.near && y <= span.far) {
        active.push(span.index);
        finest = Math.min(finest, span.stride);
      } else if (span.near > y) {
        nextStart = Math.min(nextStart, span.near);
      }
    }
    if (active.length === 0) {
      y = nextStart;
      continue;
    }
    const depth = projectDepth(frame, y);
    steps.push({
      y,
      ground: depth.ground,
      scale: depth.scale,
      clipY: depth.clipY,
      fog: landformFog(depth.rowsBeyond, frame.rollHeight),
      row: Math.round(rowAtFoot(Math.round(frame.footY - (y - frame.phaseY) * TILE_DEPTH), frame.groundTop)),
      views: active,
    });
    const slope = Math.abs(projectDepth(frame, y + 0.01).ground - depth.ground) * 100;
    // No finer than a pixel across at this distance: a far grid is denser than the screen.
    const sample = Math.max(finest, 1 / (TILE_WIDTH * depth.scale));
    y += Math.max(Math.min(sample, STEP_SCANLINES / Math.max(slope, 1e-3)), 1 / 256);
  }
  return steps;
}

/**
 * The painter's state for one frame. The march runs depth-major - every step,
 * near to far, visits only the columns a landform covers at that depth - with
 * each column's progress kept in typed arrays, so a far mountain a dozen pixels
 * wide costs a dozen columns, not the screen's width, and nothing is allocated.
 */
export class LandformPainter {
  private readonly cos: number;
  private readonly sin: number;
  /** The light as a vector in the camera's frame - x right, y away, z up - worked out once. */
  private readonly lightX: number;
  private readonly lightY: number;
  private readonly lightZ: number;
  /** Per column: the highest scanline painted so far, which nothing farther can show under. */
  private readonly lowest: Int16Array;
  /** Per column: the last step that found land there, and how tall it was, on screen. */
  private readonly lastStep: Int32Array;
  private readonly lastRise: Float32Array;
  /** Per column, for the step in hand: the tallest land found and where. */
  private readonly tallest: Float32Array;
  private readonly hitView: Int16Array;
  private readonly hitPx: Float32Array;
  private readonly hitPy: Float32Array;
  /** The column a span is being painted into, set once per span (`beginSpan`) and read per pixel. */
  private readonly pen = {
    x: 0,
    row: 0,
    h: 0,
    scale: 1,
    top: 0,
    shade: 1,
    fog: 0,
    hazy: false,
    cutaway: undefined as Cutaway | undefined,
  };
  private readonly surface: SurfaceDraft = {
    material: GRASS,
    z: 0,
    px: 0,
    py: 0,
    level: 0,
    wall: false,
    around: 0,
    wander: 0,
  };

  constructor(
    private readonly frame: CameraFrame,
    private readonly views: readonly LandformView[],
    private readonly light: LandformLight,
    private readonly out: LandformPixels,
  ) {
    this.cos = Math.cos(light.turn);
    this.sin = Math.sin(light.turn);
    const lift = Math.min(Math.max(light.elevation, 0.1), 1);
    const across = Math.sqrt(1 - lift * lift);
    this.lightX = light.light.x * across;
    this.lightY = -light.light.y * across;
    this.lightZ = lift;
    const width = out.width;
    this.lowest = new Int16Array(width).fill(out.height);
    this.lastStep = new Int32Array(width).fill(-2);
    this.lastRise = new Float32Array(width);
    this.tallest = new Float32Array(width);
    this.hitView = new Int16Array(width).fill(-1);
    this.hitPx = new Float32Array(width);
    this.hitPy = new Float32Array(width);
  }

  /** One depth: probe every landform under its own columns, then paint what rose. */
  step(index: number, step: Step, highest: number): void {
    let left = this.out.width;
    let right = -1;
    for (const viewIndex of step.views) {
      const span = this.probe(viewIndex, step, highest);
      left = Math.min(left, span.left);
      right = Math.max(right, span.right);
    }
    for (let x = left; x <= right; x += 1) {
      const h = this.tallest[x] ?? 0;
      if (h >= 0.5) {
        this.paintColumn(x, index, step, h);
      }
      this.tallest[x] = 0;
      this.hitView[x] = -1;
    }
  }

  /** The columns a view covers at a step, each given the view's height there if it is the tallest yet. */
  private probe(viewIndex: number, step: Step, highest: number): { left: number; right: number } {
    const view = this.views[viewIndex] as LandformView;
    const across = TILE_WIDTH * step.scale;
    const centre = this.frame.footX + (view.centreX - this.frame.phaseX) * across;
    const dy = step.y - view.centreY;
    // The footprint is round, so at this depth only its chord can hold land.
    const outer = view.field.landform.radius + 1;
    const chord = Math.sqrt(Math.max(0, outer * outer - dy * dy));
    // Nothing of this landform at this depth can rise above this scanline.
    const reachTop = Math.max(step.ground - view.field.peak * step.scale, highest);
    if (reachTop >= this.out.height) {
      return { left: this.out.width, right: -1 };
    }
    const left = Math.max(0, Math.floor(centre - chord * across));
    const right = Math.min(this.out.width - 1, Math.ceil(centre + chord * across));
    for (let x = left; x <= right; x += 1) {
      if ((this.lowest[x] ?? 0) <= reachTop) {
        continue;
      }
      const dx = (x + 0.5 - this.frame.footX) / across + this.frame.phaseX - view.centreX;
      // Local offset to the landform's planet-fixed frame: the inverse of `toLocal`.
      const px = dx * this.cos + dy * this.sin;
      const py = -dx * this.sin + dy * this.cos;
      // Open ground, or land that even at its block's tallest stays under what is painted.
      const bound = fieldBound(view.field, px, py);
      if (bound < 0.5 || step.ground - bound * step.scale >= (this.lowest[x] ?? 0)) {
        continue;
      }
      const h = fieldHeight(view.field, px, py);
      if (h > (this.tallest[x] ?? 0)) {
        this.tallest[x] = h;
        this.hitView[x] = viewIndex;
        this.hitPx[x] = px;
        this.hitPy[x] = py;
      }
    }
    return { left, right };
  }

  private paintColumn(x: number, index: number, step: Step, h: number): void {
    const top = step.ground - h * step.scale;
    // Never below this step's own ground - what is nearer there is open field -
    // and never below the horizon line past it.
    const lowest = this.lowest[x] ?? this.out.height;
    const from = Math.min(lowest, Math.round(step.ground), Math.round(step.clipY), this.out.height);
    const to = Math.max(Math.round(top), 0);
    // A face, where the land stood up more than a few scanlines in one step.
    const rise = h * step.scale;
    if (to < from) {
      const rising = this.lastStep[x] !== index - 1 || rise > (this.lastRise[x] ?? 0) + 3;
      this.paintSpan(x, to, from, h, rising, step);
      this.lowest[x] = to;
    }
    this.lastStep[x] = index;
    this.lastRise[x] = rise;
  }

  /** The cloud shadow on a column of one step: read where the surface is, faded with distance. */
  private shadeAt(x: number, step: Step): number {
    const shade = this.light.shade;
    if (shade === undefined) {
      return 1;
    }
    const point = cloudPoint(this.frame, x, step.y, step.scale);
    const reach = cloudReach(Math.max(0, (this.frame.groundTop - point.y) / TILE_DEPTH));
    return reach <= 0 ? 1 : 1 - (1 - shade(point.x, point.y)) * reach;
  }

  /** How brightly a sample of the field faces the light, its crags included. */
  private levelAt(field: LandformField, sample: number): number {
    const nx = field.normalX[sample] ?? 0;
    const ny = field.normalY[sample] ?? 0;
    // The normal turned into the camera's frame, against the light: `surfaceLevel`, unrolled.
    const facing =
      (nx * this.cos - ny * this.sin) * this.lightX +
      (nx * this.sin + ny * this.cos) * this.lightY +
      Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * this.lightZ;
    const crag = field.landform.kind === "tower" ? 0.03 : 0.11;
    return wrapLevel(facing) + (field.detail[sample] ?? 0) * crag;
  }

  /** Pixels `to`..`from - 1` of a column, all showing the surface one step uncovered. */
  private paintSpan(x: number, to: number, from: number, h: number, rising: boolean, step: Step): void {
    const field = (this.views[this.hitView[x] ?? 0] as LandformView).field;
    const surface = this.surface;
    surface.px = this.hitPx[x] ?? 0;
    surface.py = this.hitPy[x] ?? 0;
    const sample = fieldSample(field, surface.px, surface.py);
    const level = this.levelAt(field, sample);
    const material = field.materials[sample] ?? GRASS;
    this.beginSpan(x, step, h);
    // A span that did not rise is the top of the land: one material at one
    // light, so its two ramp steps are found once and each pixel only dithers.
    if (!rising && material !== CLIFF) {
      this.paintTop(to, from, RAMPS[material] ?? [], h < 3 ? level * 0.55 : level);
      return;
    }
    surface.level = level;
    spanOf(field, surface);
    this.paintFace(field, material, level, rising, to, from);
  }

  /** A span that may stand up: material, foot shade and grain asked per pixel. */
  private paintFace(field: LandformField, material: number, level: number, rising: boolean, to: number, from: number): void {
    const { x, top, h, scale } = this.pen;
    const surface = this.surface;
    for (let y = to; y < from; y += 1) {
      if (this.cut(y)) {
        continue;
      }
      // Below the top of a step that rose, the pixel is on the standing face.
      surface.z = h - Math.max(0, y + 0.5 - top) / scale;
      surface.wall = rising && surface.z < h - 2;
      surface.material = surface.wall ? wallMaterial(field, surface.z) : material;
      // The foot of a landform, where it meets the ground, in its own shade.
      surface.level = surface.z < 3 ? level * 0.55 : level;
      this.plot(y, colourOf(field, surface, x, y));
    }
  }

  /** A top-surface span: `stepOf` worked out once, the seam's dither per pixel. */
  private paintTop(to: number, from: number, ramp: readonly Rgb[], level: number): void {
    const scaled = Math.min(Math.max(level, 0), 1) * (ramp.length - 1);
    const base = Math.floor(scaled);
    const blend = (scaled - base - (0.5 - SEAM)) / (2 * SEAM);
    const low = ramp[base] ?? ramp[0] ?? { r: 0, g: 0, b: 0 };
    const high = ramp[Math.min(base + 1, ramp.length - 1)] ?? low;
    const x = this.pen.x;
    for (let y = to; y < from; y += 1) {
      if (!this.cut(y)) {
        this.plot(y, blend >= 1 || (blend > 0 && blend > bayer(x, y)) ? high : low);
      }
    }
  }

  /** Point the pen at a column of one step: its cloud shade, its air and the hero's window. */
  private beginSpan(x: number, step: Step, h: number): void {
    const pen = this.pen;
    pen.x = x;
    pen.row = step.row;
    pen.h = h;
    pen.scale = step.scale;
    pen.top = step.ground - h * step.scale;
    pen.shade = this.shadeAt(x, step);
    pen.fog = step.fog;
    pen.hazy = step.fog * HAZE_STEPS >= 1 / 16;
    pen.cutaway = this.cutawayFor(x, step.row);
  }

  /** Whether the hero's window keeps pixel `y` of the pen's column clear. */
  private cut(y: number): boolean {
    const pen = this.pen;
    return pen.cutaway !== undefined && cutAway(pen.cutaway, pen.x, y, pen.row);
  }

  /** One pixel of the pen's column: the ink, under the cloud and into the air. */
  private plot(y: number, rgb: Rgb): void {
    const { x, shade, fog } = this.pen;
    const out = this.out;
    const offset = (y * out.width + x) * 4;
    out.rgba[offset] = rgb.r * shade;
    out.rgba[offset + 1] = rgb.g * shade;
    out.rgba[offset + 2] = rgb.b * shade;
    out.rgba[offset + 3] = 255;
    if (this.pen.hazy) {
      hazeInto(out.rgba, offset, this.light.haze, fog, x, y);
    }
    out.rows[y * out.width + x] = this.pen.row;
  }

  /** The hero's window, if this column of this row could be in it at all. */
  private cutawayFor(x: number, row: number): Cutaway | undefined {
    const cutaway = this.light.cutaway;
    if (cutaway === undefined || row <= cutaway.row || Math.abs(x - cutaway.x) >= cutaway.radiusX) {
      return undefined;
    }
    return cutaway;
  }
}
