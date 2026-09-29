/**
 * Grass tufts, pre-rendered: a handful of shapes, each at every bend it can take.
 *
 * The grass this replaces was five two-pixel strokes per cell, drawn with a
 * `fillRect` per pixel every frame - sticks, at 3 ms a frame. A tuft's look is a
 * function of exactly two things, which one it is and how far the wind has
 * bent it, so both are baked once into one texture (`TUFT_SHAPES` x
 * `BEND_FRAMES`) and a frame of animation is just choosing a frame.
 *
 * A blade is a curve from root to tip, drawn one row at a time. The wind bends
 * it by an offset that grows with the *square* of the height, so the root never
 * moves and the tip does most of the travelling - a bend, not a shear - and each
 * blade takes a slightly different share of it, so a tuft ripples rather than
 * tilting as one piece. Colour climbs the ramp with height: dark where the
 * blades crowd at the root, lit where the tips catch the sun.
 */

import type { InkId, PixelCloud } from "../ink";
import { strokeLine } from "../ink";
import { createBuffer, paintInto, type PixelBuffer } from "../pixel-buffer";
import { pixelHash } from "../transforms";

/** Bend levels, left to right; the tip of the tallest blade moves this many pixels at the extremes. */
export const BEND_LEVELS = 7;
export const MAX_BEND = 3;
/** Two extra frames per shape: pressed flat to the left and to the right, underfoot. */
export const FLAT_LEFT = BEND_LEVELS;
export const FLAT_RIGHT = BEND_LEVELS + 1;
export const BEND_FRAMES = BEND_LEVELS + 2;

/** Every tuft frame shares one box; (originX, originY) is the root. */
export const TUFT_FRAME = { width: 30, height: 14, originX: 15, originY: 12 } as const;

export type TuftKind = "grass" | "tall" | "flower" | "clover" | "fern" | "dry";

export interface Blade {
  readonly root: number;
  readonly height: number;
  /** Static lean at the tip, px. */
  readonly lean: number;
  /** Share of the wind this blade takes, ~0.6..1.3. */
  readonly flex: number;
  /** 0 is a back blade (drawn first, a step darker), 1 is in front. */
  readonly front: number;
  readonly tip: InkId;
}

export interface TuftShape {
  readonly kind: TuftKind;
  readonly seed: number;
  readonly blades: readonly Blade[];
  /** Flowers at the tips of these blade indices. */
  readonly flowers: readonly { readonly blade: number; readonly ink: InkId }[];
}

const PETALS: readonly InkId[] = ["petal-0", "petal-1", "petal-2", "petal-3", "petal-4", "petal-5"];

/** The shapes in the atlas, in frame order. Grass dominates, as it does in a meadow. */
export const TUFT_KINDS: readonly TuftKind[] = [
  "grass", "grass", "grass", "grass", "grass", "grass",
  "tall", "tall", "flower", "flower", "clover", "fern", "dry", "dry",
];

interface KindSpec {
  readonly blades: readonly [number, number];
  readonly heights: readonly [number, number];
  readonly spread: number;
  readonly tips: readonly InkId[];
}

const KIND_SPECS: Readonly<Record<TuftKind, KindSpec>> = {
  grass: { blades: [7, 11], heights: [3, 7], spread: 5, tips: ["grass-4", "grass-5", "grass-4", "meadow-1"] },
  tall: { blades: [9, 14], heights: [5, 9], spread: 6, tips: ["grass-5", "meadow-2", "meadow-1"] },
  flower: { blades: [6, 9], heights: [3, 6], spread: 4, tips: ["grass-4", "grass-5"] },
  clover: { blades: [6, 8], heights: [2, 4], spread: 4, tips: ["grass-4", "grass-5"] },
  fern: { blades: [6, 8], heights: [5, 8], spread: 5, tips: ["leaf-4", "leaf-5"] },
  dry: { blades: [6, 9], heights: [4, 8], spread: 6, tips: ["meadow-3", "meadow-2", "meadow-4"] },
};

function between(range: readonly [number, number], roll: number): number {
  return range[0] + Math.floor(roll * (range[1] - range[0] + 1));
}

export function tuftShape(index: number): TuftShape {
  const kind = TUFT_KINDS[index] ?? "grass";
  const spec = KIND_SPECS[kind];
  const seed = 0x7af7 + index * 977;
  const count = between(spec.blades, pixelHash(index, 0, seed, 1));
  const blades: Blade[] = [];
  for (let blade = 0; blade < count; blade += 1) {
    const roll = (salt: number): number => pixelHash(blade, index, seed, salt);
    // A fan: blades are spread evenly across the clump's base with a little
    // jitter, and each leans outward in proportion to where it stands, so the
    // tips open into the V a real tuft has instead of rising as one column.
    const across = count === 1 ? 0 : blade / (count - 1) - 0.5;
    const root = Math.round(across * spec.spread + (roll(2) - 0.5) * 2);
    const centre = 1 - Math.abs(across) * 2;
    blades.push({
      root,
      height: Math.max(2, Math.round(between(spec.heights, roll(4)) * (0.6 + 0.4 * centre))),
      lean: across * spec.spread * 1.1 + (roll(5) - 0.5) * 1.6,
      flex: 0.6 + roll(6) * 0.7,
      front: roll(7),
      tip: spec.tips[Math.floor(roll(8) * spec.tips.length)] ?? "grass-4",
    });
  }
  blades.sort((a, b) => a.front - b.front);
  const flowers: { blade: number; ink: InkId }[] = [];
  if (kind === "flower") {
    const flowerCount = 1 + Math.floor(pixelHash(index, 1, seed, 9) * 3);
    const ink = PETALS[Math.floor(pixelHash(index, 2, seed, 10) * PETALS.length)] ?? "petal-2";
    for (let flower = 0; flower < flowerCount; flower += 1) {
      flowers.push({ blade: blades.length - 1 - flower * 2, ink });
    }
  }
  return { kind, seed, blades, flowers };
}

export const TUFT_SHAPES: readonly TuftShape[] = TUFT_KINDS.map((_kind, index) => tuftShape(index));

const STALK: readonly InkId[] = ["grass-1", "grass-2", "grass-3"];

/** Where a blade is at height fraction `t` for a tip displacement of `bend` px. */
function bladeX(blade: Blade, t: number, bend: number): number {
  return blade.root + blade.lean * t + bend * blade.flex * t * t;
}

function stalkInk(blade: Blade, t: number, kind: TuftKind): InkId {
  if (t >= 0.78) {
    return blade.tip;
  }
  const base = kind === "fern" ? ["leaf-2", "leaf-3", "leaf-3"] as const : kind === "dry" ? ["grass-2", "grass-3", "meadow-0"] as const : STALK;
  const step = Math.min(base.length - 1, Math.floor(t * base.length + blade.front * 0.6));
  return base[Math.max(0, step)] ?? "grass-2";
}

/** One blade as a connected run of pixels, root to tip. Returns the tip. */
function drawBlade(cloud: PixelCloud, blade: Blade, bend: number, squash: number, kind: TuftKind): { x: number; y: number } {
  const height = Math.max(1, Math.round(blade.height * squash));
  let previous = { x: blade.root, y: 0 };
  cloud.push({ x: blade.root, y: 0, ink: "grass-1" });
  for (let step = 1; step <= height; step += 1) {
    const t = step / height;
    const point = { x: Math.round(bladeX(blade, t, bend)), y: -step };
    const ink = stalkInk(blade, t, kind);
    if (Math.abs(point.x - previous.x) > 1) {
      // A steep lean joins the rows with a stroke; the stroke may not add to
      // the root row, or a bend would appear to move the tuft's footing.
      const joined: PixelCloud = [];
      strokeLine(joined, previous, point, ink);
      cloud.push(...joined.filter((pixel) => pixel.y < 0));
    } else {
      cloud.push({ ...point, ink });
    }
    if (kind === "fern" && step % 2 === 0 && step < height) {
      const side = step % 4 === 0 ? 1 : -1;
      cloud.push({ x: point.x + side, y: point.y, ink: "leaf-4" });
      cloud.push({ x: point.x + side * 2, y: point.y + 1, ink: "leaf-3" });
    }
    previous = point;
  }
  return previous;
}

function drawFlower(cloud: PixelCloud, tip: { x: number; y: number }, ink: InkId, large: boolean): void {
  cloud.push({ x: tip.x, y: tip.y - 1, ink });
  if (large) {
    cloud.push({ x: tip.x - 1, y: tip.y - 1, ink });
    cloud.push({ x: tip.x + 1, y: tip.y - 1, ink });
    cloud.push({ x: tip.x, y: tip.y - 2, ink });
    cloud.push({ x: tip.x, y: tip.y - 1, ink: "petal-1" });
  }
}

/** Round clover leaves low in the tuft, each lit on its upper-left pixel. */
function drawClover(cloud: PixelCloud, shape: TuftShape, bend: number): void {
  for (let leaf = 0; leaf < 3; leaf += 1) {
    const x = Math.round((pixelHash(leaf, 3, shape.seed, 11) - 0.5) * 7 + bend * 0.3);
    const y = -2 - Math.floor(pixelHash(leaf, 4, shape.seed, 12) * 2);
    cloud.push({ x, y, ink: "grass-5" });
    cloud.push({ x: x + 1, y, ink: "grass-4" });
    cloud.push({ x, y: y + 1, ink: "grass-3" });
    cloud.push({ x: x + 1, y: y + 1, ink: "grass-2" });
  }
}

/**
 * A tuft at one bend frame (`0..BEND_FRAMES-1`), foot-anchored at its root.
 *
 * Frames `0..BEND_LEVELS-1` bend the tips from `-MAX_BEND` to `+MAX_BEND`;
 * `FLAT_LEFT` and `FLAT_RIGHT` are the tuft trodden flat - shorter and leaning
 * hard away from whatever is standing on it.
 */
export function tuftCloud(shape: TuftShape, frame: number): PixelCloud {
  const flat = frame === FLAT_LEFT || frame === FLAT_RIGHT;
  const bend = flat ? (frame === FLAT_LEFT ? -5 : 5) : frame - (BEND_LEVELS - 1) / 2;
  const squash = flat ? 0.55 : 1;
  const cloud: PixelCloud = [];
  const roots = shape.blades.map((blade) => blade.root);
  const left = Math.min(...roots);
  const right = Math.max(...roots);
  // A soft contact shadow under the clump, pushed away from the top-left light.
  for (let x = left; x <= right + 1; x += 1) {
    cloud.push({ x, y: 1, ink: "shadow-soft" });
  }
  const tips: { x: number; y: number }[] = [];
  for (const blade of shape.blades) {
    tips.push(drawBlade(cloud, blade, bend * (MAX_BEND / 3), squash, shape.kind));
  }
  if (shape.kind === "clover") {
    drawClover(cloud, shape, bend);
  }
  for (const flower of shape.flowers) {
    const tip = tips[flower.blade];
    if (tip !== undefined) {
      drawFlower(cloud, tip, flower.ink, !flat && flower.blade === shape.blades.length - 1);
    }
  }
  return cloud;
}

/** Frame index in the atlas of shape `shape` at bend frame `bend`. */
export function tuftFrame(shape: number, bend: number): number {
  return shape * BEND_FRAMES + bend;
}

/**
 * The bend frame for a signed wind displacement, in bend levels (-3..3 is the
 * full range; anything past it saturates, and a NaN is no wind).
 */
export function bendFrame(displacement: number): number {
  if (Number.isNaN(displacement)) {
    return (BEND_LEVELS - 1) / 2;
  }
  const level = Math.round(Math.min(Math.max(displacement, -MAX_BEND), MAX_BEND));
  return level + (BEND_LEVELS - 1) / 2;
}

/** Every shape at every bend, in atlas order - what `installStrip` bakes. */
export function tuftBuffers(): PixelBuffer[] {
  const buffers: PixelBuffer[] = [];
  for (const shape of TUFT_SHAPES) {
    for (let bend = 0; bend < BEND_FRAMES; bend += 1) {
      const buffer = createBuffer(TUFT_FRAME.width, TUFT_FRAME.height);
      paintInto(buffer, tuftCloud(shape, bend), TUFT_FRAME.originX, TUFT_FRAME.originY);
      buffers.push(buffer);
    }
  }
  return buffers;
}
