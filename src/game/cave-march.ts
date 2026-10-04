/**
 * Drawing the inside of a cave: one march over depth, through the treadmill.
 *
 * The same pass the landforms are drawn by (`landform-march.ts`), cut down to
 * one map. A screen column is a line on the ground running away from the
 * camera; walk up it from near to far, asking `projectDepth` at each step where
 * the ground is and how large things are there, and keep the highest scanline
 * painted - a nearer wall hides the floor beyond it because it was reached
 * first. So the floor runs to the field's far edge and carries on over the lip
 * of the horizon, the walls stand full size on the field, shrink up the roll
 * and sink foot first behind the horizon line, and the end of a deep cave is a
 * speck of back wall on the horizon that grows as you walk to it.
 *
 *     floor      the cave's grain, darkening with distance - the deep is dark
 *     wall face  the first step a column meets rock: strata, a lit rim on top
 *     rock top   every step after: the dark mass of rock, seen from above
 *     torches    a flame on the wall, a glint of fire far down the tunnel
 *
 * Two pictures come out: walls nearer than the hero go in `front`, which is
 * drawn over him, and everything else in `back`, under him - so he walks behind
 * a wall's face and in front of the floor. Every pixel's depth is kept, so a
 * torch round a bend is hidden by the rock between.
 *
 * Pure: a view in, pixels out. The lab draws it from a fixed pose.
 */

import { localPlacement, projectDepth, type CameraFrame } from "./camera";
import { caveCoords, grainAt, heightAt, WALL_TILES, EXIT_GLOW, type CaveMap, type CavePoint } from "./cave-map";
import { torchCloud } from "./cave-backdrop";
import { ROLL_ROWS, rowsToSink } from "./horizon";
import type { InkId, PixelCloud } from "./ink";
import { flicker, type LightSource } from "./lights";
import { hexToRgb } from "./color";
import { clearBuffer, type PixelBuffer } from "./pixel-buffer";
import { fromLocal, type PlanetPose } from "./planet";
import { INK_COLORS } from "./ink";
import { TILE_DEPTH, TILE_WIDTH, WALL_RISE } from "./projection";
import { ditherThreshold } from "./shading";
import { pixelHash } from "./transforms";

const FLOOR: readonly InkId[] = ["stone-1", "stone-2", "stone-3", "stone-4"];
const LIT: readonly InkId[] = ["stone-2", "stone-3", "stone-4", "stone-5"];
const FACE: readonly InkId[] = ["stone-1", "stone-2", "stone-3", "stone-4"];

/** How dark the far floor and walls go, at most: the deep fades into the dark. */
const DEEP_DARK = 0.55;

/** A torch's pool on the world at full size, logical pixels. */
const TORCH_RADIUS = 46;

/** How high up the wall a torch is mounted, tiles. */
const TORCH_HEIGHT = 1.3;

export interface CaveView {
  readonly frame: CameraFrame;
  /** The pose the world is sampled from this frame. */
  readonly pose: PlanetPose;
  /** The mouth, facing the way the hero walked in. */
  readonly entry: PlanetPose;
  readonly map: CaveMap;
  readonly elapsedMs: number;
}

export interface CavePicture {
  readonly back: PixelBuffer;
  readonly front: PixelBuffer;
  /** The local depth each pixel shows, NaN where nothing was painted. */
  readonly depth: Float32Array;
}

/** Local tiles to cave coordinates, as an affine map: `at(x, y) = origin + x * right + y * ahead`. */
interface CaveAxes {
  readonly origin: CavePoint;
  readonly right: CavePoint;
  readonly ahead: CavePoint;
}

function axesOf(entry: PlanetPose, pose: PlanetPose): CaveAxes {
  const origin = caveCoords(entry, fromLocal(pose, { x: 0, y: 0 }));
  const right = caveCoords(entry, fromLocal(pose, { x: 1, y: 0 }));
  const ahead = caveCoords(entry, fromLocal(pose, { x: 0, y: 1 }));
  return {
    origin,
    right: { across: right.across - origin.across, along: right.along - origin.along },
    ahead: { across: ahead.across - origin.across, along: ahead.along - origin.along },
  };
}

/** One depth of the march, the same for every column. */
interface Step {
  readonly y: number;
  readonly ground: number;
  readonly scale: number;
  readonly clipY: number;
  readonly dark: number;
}

/**
 * The depths to march, near to far: from far enough behind the hero that a
 * wall there still rises into the picture, to where the tallest wall has sunk
 * behind the horizon line. A step moves the ground at most a scanline and
 * never skips a grid cell.
 */
export function caveSchedule(frame: CameraFrame, height: number): Step[] {
  const rise = WALL_TILES * WALL_RISE;
  // Rock behind the hero is cut to a ledge (`cutAway`), so only a ledge's height below the screen can rise into it.
  const near = frame.phaseY - (height - frame.footY + LEDGE_TILES * WALL_RISE) / TILE_DEPTH - 0.25;
  const toEdge = (frame.footY - frame.groundTop) / TILE_DEPTH;
  const far = frame.phaseY + toEdge + ROLL_ROWS + rowsToSink(rise);
  const steps: Step[] = [];
  let y = near;
  while (y <= far) {
    const depth = projectDepth(frame, y);
    steps.push({
      y,
      ground: depth.ground,
      scale: depth.scale,
      clipY: depth.clipY,
      dark: DEEP_DARK * Math.min(depth.rowsBeyond / ROLL_ROWS, 1),
    });
    const slope = Math.abs(projectDepth(frame, y + 0.01).ground - depth.ground) * 100;
    // One scanline of ground a step - the finest the screen can show - and never more
    // than a tile on the roll and past it, where a scanline already spans rows and a
    // longer stride could step over a wall.
    y += Math.min(Math.max(1 / Math.max(slope, 1e-3), 1 / 64), 1);
  }
  return steps;
}

/** Where the march's pixels go: two pictures and a depth per pixel. */
interface CaveSink {
  readonly width: number;
  readonly height: number;
  readonly depth: Float32Array;
  put(front: boolean, x: number, y: number, ink: InkId): void;
}

/** Draw the cave into `out` for this view. */
export function renderCave(view: CaveView, out: CavePicture): void {
  clearBuffer(out.back);
  clearBuffer(out.front);
  // Every cave ink is opaque, so a pixel is one word written, not a composite.
  const back = new Uint32Array(out.back.data.buffer, out.back.data.byteOffset, out.back.width * out.back.height);
  const front = new Uint32Array(out.front.data.buffer, out.front.data.byteOffset, out.front.width * out.front.height);
  const width = out.back.width;
  march(view, {
    width,
    height: out.back.height,
    depth: out.depth,
    put: (isFront, x, y, ink) => {
      (isFront ? front : back)[y * width + x] = wordOf(ink);
    },
  });
}

const WORDS = new Map<InkId, number>();

/** An opaque ink as the little-endian RGBA word a buffer holds. */
function wordOf(ink: InkId): number {
  let word = WORDS.get(ink);
  if (word === undefined) {
    const { r, g, b } = hexToRgb(INK_COLORS[ink]);
    word = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
    WORDS.set(ink, word);
  }
  return word;
}

/** The same picture as ink clouds, back and front - what the asset lab shows. */
export function caveClouds(view: CaveView, width: number, height: number): { back: PixelCloud; front: PixelCloud } {
  const back: PixelCloud = [];
  const front: PixelCloud = [];
  march(view, {
    width,
    height,
    depth: new Float32Array(width * height),
    put: (isFront, x, y, ink) => (isFront ? front : back).push({ x, y, ink }),
  });
  return { back, front };
}

function march(view: CaveView, sink: CaveSink): void {
  sink.depth.fill(Number.NaN);
  const axes = axesOf(view.entry, view.pose);
  const steps = caveSchedule(view.frame, sink.height);
  for (let x = 0; x < sink.width; x += 1) {
    marchColumn(view, axes, steps, x, sink);
  }
  drawTorches(view, axes, sink);
}

/** One screen column, near to far. `at` is one sample object reused for every step: no garbage a pixel. */
function marchColumn(view: CaveView, axes: CaveAxes, steps: readonly Step[], x: number, out: CaveSink): void {
  const { frame, map } = view;
  const height = out.height;
  let top = height;
  let below = 0;
  const at = SCRATCH;
  at.x = x;
  for (const step of steps) {
    // Past the horizon line things only sink: once the tallest wall there could
    // not rise above what is painted, nothing further on can either.
    const tallest = step.ground - WALL_TILES * WALL_RISE * step.scale;
    if (top <= 0 || (Number.isFinite(step.clipY) && top <= tallest)) {
      return;
    }
    const lx = frame.phaseX + (x - frame.footX) / (TILE_WIDTH * step.scale);
    const across = axes.origin.across + lx * axes.right.across + step.y * axes.ahead.across;
    const along = axes.origin.along + lx * axes.right.along + step.y * axes.ahead.along;
    const raw = heightAt(map, across, along);
    const stands = cutAway(raw, step.y - frame.phaseY);
    const surface = Math.max(Math.ceil(step.ground - stands * WALL_RISE * step.scale), 0);
    const last = Math.min(top, Math.ceil(step.clipY));
    if (surface < last) {
      at.step = step;
      at.along = along;
      at.stands = stands;
      // A face only where rock rises from open floor; a cut edge is the top of the rock.
      at.entered = raw > below;
      at.surface = surface;
      at.grain = grainAt(map, across, along);
      at.lit = stands === 0 && Math.hypot(across, along) < EXIT_GLOW;
      at.front = stands > 0 && step.y < frame.phaseY;
      for (let y = surface; y < last; y += 1) {
        paint(out, at, y);
      }
      top = surface;
    }
    below = raw;
  }
}

/** Tiles nearer the camera than the hero over which rock drops from its height to a ledge. */
const CUT_TILES = 0.75;

/** What is left of a cut-away wall: a ledge, so the rock's edge still shows. */
const LEDGE_TILES = 0.2;

/**
 * Rock nearer the camera than the hero, cut down to a ledge.
 *
 * A wall stands three tiles - taller than the hero - so any rock between him
 * and the camera would bury him, and in a tunnel there is always rock there.
 * The landforms answer the same problem with a window (`landform-cutaway.ts`);
 * a cave answers it the way overhead games always have: the near wall is not
 * drawn high. Rock level with him and beyond stands full height, rock behind
 * him eases down over `CUT_TILES` to a ledge, so nothing pops as he walks.
 * Walking only - what stops him is the map, not this.
 */
export function cutAway(stands: number, ahead: number): number {
  if (stands === 0 || ahead >= 0) {
    return stands;
  }
  const keep = Math.max(0, 1 + ahead / CUT_TILES);
  return Math.max(LEDGE_TILES, stands * keep);
}

/** What one step of one column found, and everything its pixels share. */
interface Sample {
  x: number;
  step: Step;
  along: number;
  stands: number;
  /** Whether this column met rock at this step rather than an earlier one: a face, not a top. */
  entered: boolean;
  surface: number;
  grain: number;
  /** Floor in the day falling through the mouth. */
  lit: boolean;
  /** Rock nearer than the hero: drawn over him. */
  front: boolean;
}

const SCRATCH: Sample = {
  x: 0,
  step: { y: 0, ground: 0, scale: 1, clipY: 0, dark: 0 },
  along: 0,
  stands: 0,
  entered: false,
  surface: 0,
  grain: 0,
  lit: false,
  front: false,
};

function paint(out: CaveSink, at: Sample, y: number): void {
  const { x, step } = at;
  let ink: InkId;
  if (at.stands === 0) {
    ink = rampAt(at.lit ? LIT : FLOOR, 0.15 + at.grain * 0.7 - step.dark, x, y);
  } else {
    ink = at.entered ? faceInk(at, y, at.grain) : topInk(at.grain);
  }
  out.put(at.front, x, y, ink);
  out.depth[y * out.width + x] = step.y;
}

/** A wall's face: courses of strata, a lit rim along its top, its foot in shadow. */
function faceInk(at: Sample, y: number, grain: number): InkId {
  if (y === at.surface) {
    return at.step.dark > 0.3 ? "stone-2" : "stone-4";
  }
  const up = (at.step.ground - y) / (WALL_RISE * at.step.scale);
  if (up < 0.12) {
    return "stone-0";
  }
  const course = Math.floor(up * 3);
  if (up * 3 - course < 0.12) {
    return "stone-1";
  }
  const tone = 0.25 + pixelHash(course, Math.floor(at.along * 2), 0x5a7) * 0.25 + grain * 0.3 - at.step.dark;
  return rampAt(FACE, tone, at.x, y);
}

/**
 * `rampInk` with its dither, without the object it takes: the march asks for
 * tens of thousands of inks a frame, and each one's `{ x, y }` was garbage.
 */
function rampAt(ramp: readonly InkId[], level: number, x: number, y: number): InkId {
  const scaled = Math.min(Math.max(level, 0), 1) * (ramp.length - 1);
  const base = Math.floor(scaled);
  const index = scaled - base > ditherThreshold(x, y) ? base + 1 : base;
  return ramp[Math.min(index, ramp.length - 1)] as InkId;
}

/** The top of the rock: the dark mass of it, flecked by its own grain - so the flecks move with it. */
function topInk(grain: number): InkId {
  return grain > 0.72 ? "stone-1" : "stone-0";
}

/** Where a cave point is in the local frame - the inverse of the axes, which are a rotation. */
function localOf(axes: CaveAxes, point: CavePoint): { x: number; y: number } {
  const dx = point.across - axes.origin.across;
  const dy = point.along - axes.origin.along;
  return {
    x: dx * axes.right.across + dy * axes.right.along,
    y: dx * axes.ahead.across + dy * axes.ahead.along,
  };
}

/** Each torch's flame, where no nearer rock hides it: whole on the field, a glint of fire far off. */
function drawTorches(view: CaveView, axes: CaveAxes, out: CaveSink): void {
  const width = out.width;
  const tick = Math.floor(view.elapsedMs / 90) * 90;
  for (const torch of view.map.torches) {
    const local = localOf(axes, torch);
    const placed = localPlacement(view.frame, local);
    if (!placed.visible) {
      continue;
    }
    const mountY = Math.round(placed.y - TORCH_HEIGHT * WALL_RISE * placed.scale);
    const front = local.y < view.frame.phaseY;
    const cloud = placed.scale > 0.6 ? torchCloud(tick, torch.seed) : [{ x: 0, y: 0, ink: "fire-5" as InkId }];
    for (const pixel of cloud) {
      const px = placed.x + pixel.x;
      const py = mountY + pixel.y;
      if (px < 0 || py < 0 || px >= width || py >= out.height || py >= placed.clipY) {
        continue;
      }
      const shown = out.depth[py * width + px];
      if (shown === undefined || Number.isNaN(shown) || shown >= local.y - 0.75) {
        out.put(front, px, py, pixel.ink);
      }
    }
  }
}

/** The light the cave gives off this instant: each torch in sight, and the day at the way out. */
export function caveLights(view: CaveView): LightSource[] {
  const axes = axesOf(view.entry, view.pose);
  const lights: LightSource[] = [];
  for (const torch of view.map.torches) {
    const placed = localPlacement(view.frame, localOf(axes, torch));
    if (!placed.visible || placed.scale < 0.3) {
      continue;
    }
    lights.push({
      x: placed.x,
      y: Math.round(placed.y - TORCH_HEIGHT * WALL_RISE * placed.scale),
      radius: Math.max(8, Math.round(TORCH_RADIUS * placed.scale)),
      color: INK_COLORS["fire-5"],
      intensity: 0.95 * flicker(view.elapsedMs, torch.seed),
    });
  }
  const exit = localPlacement(view.frame, localOf(axes, { across: 0, along: -0.4 }));
  if (exit.visible) {
    lights.push({ x: exit.x, y: exit.y - TILE_DEPTH / 2, radius: 40, color: INK_COLORS.foam, intensity: 0.9 });
  }
  return lights;
}
