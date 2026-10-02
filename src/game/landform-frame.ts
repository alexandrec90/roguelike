/**
 * What a frame of landforms is: the views the march reads, the light it is lit
 * by, the window kept round the hero, and the pixels it writes - colour, and
 * the affine row of the surface each pixel shows, which is what lets the layer
 * cut the picture into depth slices (`landform-slices.ts`).
 *
 * The march itself is `landform-march.ts`, the look `landform-colour.ts`, and
 * the frame-level passes - which landforms are in sight, near over far, the
 * outline - `landform-render.ts`.
 */

import type { Rgb } from "./color";
import type { LandformField } from "./landforms";
import { BAYER_4X4 } from "./shading";

/** One landform in view: its grid, and where its centre is in local tiles this frame. */
export interface LandformView {
  readonly field: LandformField;
  readonly centreX: number;
  readonly centreY: number;
}

export interface LandformLight {
  /** Screen-space direction toward the light, +y down. */
  readonly light: { readonly x: number; readonly y: number };
  /** 0..1: how high the light stands. */
  readonly elevation: number;
  /** The pose's turn: planet-fixed normals are turned into the camera's frame by it. */
  readonly turn: number;
  /** The air far things are tinted toward, already divided by the ambient. */
  readonly haze: Rgb;
  /** Multiply level of cloud shadow on the ground at a screen point; leave out for none. */
  readonly shade?: (x: number, y: number) => number;
  /** A window kept clear round the hero through anything standing nearer than him. */
  readonly cutaway?: Cutaway;
}

/**
 * The hero's window through a landform in front of him.
 *
 * The camera looks down from behind him, so anything tall standing between -
 * a tower a few rows nearer, the flank of a mountain he has walked past - is,
 * correctly, in front of him on the screen. Correct and useless: he vanishes.
 * Every overhead game makes the same trade, and this one makes it in pixels:
 * landform pixels nearer than his row, inside an oval round him, are left out,
 * the oval's rim dithered so it reads as a window rather than a hole.
 */
export interface Cutaway {
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
  /** His affine row: only what stands nearer than it is cut. */
  readonly row: number;
}

/** Whether the cutaway takes a pixel: inside the oval, its rim dithered over the outer fifth. */
export function cutAway(cutaway: Cutaway, x: number, y: number, row: number): boolean {
  if (row <= cutaway.row || Math.abs(x - cutaway.x) >= cutaway.radiusX || Math.abs(y - cutaway.y) >= cutaway.radiusY) {
    return false;
  }
  const dx = (x - cutaway.x) / cutaway.radiusX;
  const dy = (y - cutaway.y) / cutaway.radiusY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance >= 1) {
    return false;
  }
  return distance < 0.8 || (1 - distance) / 0.2 > bayer(x, y);
}

/** A frame of landforms: colour, and the affine row of the surface each pixel shows. */
export interface LandformPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
  readonly rows: Int16Array;
  /**
   * The scanlines holding land, `top` to `bottom` exclusive, and the farthest
   * row among them: kept by `mergeLandforms`, so the passes after it scan only
   * the band of the screen the land is in. Empty is `top >= bottom`.
   */
  readonly extent: { top: number; bottom: number; farthest: number };
}

/** `rows` value for a pixel no landform covers. */
export const NO_ROW = -32768;

export function createLandformPixels(width: number, height: number): LandformPixels {
  return {
    width,
    height,
    rgba: new Uint8ClampedArray(width * height * 4),
    rows: new Int16Array(width * height).fill(NO_ROW),
    extent: { top: 0, bottom: height, farthest: NO_ROW },
  };
}

/** `ditherThreshold` for a whole, non-negative screen pixel, without its rounding: this runs per pixel. */
export function bayer(x: number, y: number): number {
  return BAYER_4X4[y & 3]?.[x & 3] ?? 0.5;
}
