/**
 * A cave's mouth on the overworld: a mound of rock with an arch in it.
 *
 * A flat 2.5D prop that always faces the camera. The planet turns under the
 * hero when he strafes, but the mouth's *art* never does - only where it
 * stands - so whichever way he walks up to it, the opening is the side he
 * sees, and walking onto its foot takes him in (`caves.ts`).
 *
 * It is a description, not a drawing: a bumpy ellipse with an arch cut from
 * its foot, lit per pixel from a dome normal by the same screen-space light as
 * everything else, outlined, mossed on top, and given a contact shadow. That
 * is what lets it be drawn at any `scale` - the horizon roll's, a speck on the
 * horizon line - by evaluating the same shape at each screen pixel, with the
 * dither locked to the screen grid, rather than by shrinking a sprite.
 *
 * Foot-anchored: (0, 0) is the middle of the mouth's threshold.
 */

import type { InkId, PixelCloud } from "./ink";
import { valueNoise2 } from "./procgen/noise";
import { rampInk } from "./shading";

/** The mound at full size, art pixels. */
const MOUND = { cx: 0, cy: -11, rx: 18, ry: 13 } as const;

/** The arch: half its width, and how high its round top's centre sits. */
const ARCH = { half: 5.5, spring: -8 } as const;

/** How wide the art is at full size, from the foot - for a layer sizing its sweep. */
export const ENTRANCE_HALF_WIDTH = 20;

/** How tall it stands at full size. */
export const ENTRANCE_HEIGHT = 26;

const SEED = 0x30c4;

const STONE: readonly InkId[] = ["stone-1", "stone-2", "stone-3", "stone-4", "stone-5"];
const MOSS: readonly InkId[] = ["moss-0", "moss-1", "moss-2", "moss-3"];

export interface EntranceLight {
  /** Screen-space direction toward the light, +y down. */
  readonly light: { readonly x: number; readonly y: number };
  /** 0..1: how high the light stands. */
  readonly elevation: number;
}

/** Whether an art point is in the mound, edge bumped by noise round its rim. */
function inMound(x: number, y: number): boolean {
  if (y > 0) {
    return false;
  }
  const dx = (x - MOUND.cx) / MOUND.rx;
  const dy = (y - MOUND.cy) / MOUND.ry;
  const angle = Math.atan2(dy, dx);
  const bump = (valueNoise2(Math.cos(angle) * 2.5 + 4, Math.sin(angle) * 2.5 + 4, SEED) - 0.5) * 0.22;
  return Math.hypot(dx, dy) < 1 + bump;
}

/** Whether an art point is in the arch's opening. */
function inArch(x: number, y: number): boolean {
  if (y > 0) {
    return false;
  }
  return (Math.abs(x) <= ARCH.half && y >= ARCH.spring) || Math.hypot(x, y - ARCH.spring) <= ARCH.half;
}

/** The mound's ink at an art point: lit from a dome normal, with grain and moss. */
function stoneInk(x: number, y: number, at: { readonly x: number; readonly y: number }, lit: EntranceLight): InkId {
  const nx = (x - MOUND.cx) / MOUND.rx;
  const ny = (y - MOUND.cy) / MOUND.ry;
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const length = Math.hypot(lit.light.x, lit.light.y, lit.elevation) || 1;
  const facing = (nx * lit.light.x + ny * lit.light.y + nz * lit.elevation) / length;
  const grain = valueNoise2(x / 3, y / 3, SEED ^ 0x1);
  const level = 0.15 + Math.max(0, facing) * 0.6 + grain * 0.2;
  if (ny < -0.45 && valueNoise2(x / 4, y / 4, SEED ^ 0x2) > 0.5) {
    return rampInk(MOSS, level, at);
  }
  return rampInk(STONE, level, at);
}

/**
 * The mouth at `scale` (1 on the field; smaller on the horizon roll), lit by
 * `lit`. Each output pixel evaluates the shape at its own art point.
 */
export function caveEntranceCloud(scale: number, lit: EntranceLight): PixelCloud {
  const s = Math.max(scale, 0.05);
  const art = (pixel: number): number => (pixel + 0.5) / s;
  const cloud: PixelCloud = [];
  const half = Math.ceil(ENTRANCE_HALF_WIDTH * s);
  const top = -Math.ceil(ENTRANCE_HEIGHT * s);
  const shadowDepth = Math.max(1, Math.round(2 * s));
  for (let py = top; py <= shadowDepth; py += 1) {
    for (let px = -half; px <= half; px += 1) {
      const ink = entranceInk(art(px), art(py), s, { x: px, y: py }, lit);
      if (ink !== undefined) {
        cloud.push({ x: px, y: py, ink });
      }
    }
  }
  return cloud;
}

/** The ink at one art point, or undefined where the mouth is not. */
function entranceInk(
  x: number,
  y: number,
  s: number,
  at: { readonly x: number; readonly y: number },
  lit: EntranceLight,
): InkId | undefined {
  const step = 1 / s;
  if (inArch(x, y)) {
    // A rim of stone in shadow just inside the arch, then the dark.
    return inArch(x, y - step) && inArch(x - step, y) && inArch(x + step, y) ? "void" : "stone-0";
  }
  if (inMound(x, y)) {
    const edge = !inMound(x, y - step) || !inMound(x - step, y) || !inMound(x + step, y);
    return edge ? "stone-0" : stoneInk(x, y, at, lit);
  }
  // A contact shadow at the foot, flat on the ground and wider than the mound.
  const dx = x / (MOUND.rx + 2);
  const dy = y / 3;
  return dx * dx + dy * dy < 1 ? "shadow" : undefined;
}
