/**
 * A lit volumetric body: the mechanism the chestnut crown turned out to be.
 *
 * A body is a handful of overlapping lobes welded by a smooth union, warped by
 * noise, and rasterised with the light applied per pixel from the field's own
 * gradient. That combination is what makes the chestnut read as a solid object
 * with a lit side, a dark underside and a rim, rather than as a flat shape with
 * a texture on it — and *none of it is about trees*. A boulder is the same
 * thing with squatter lobes and a stone ramp; a bush is the same thing smaller;
 * a slime, a mushroom cap, a bread loaf, a cloud, a pile of skulls are all the
 * same thing with different lobes and a different ramp.
 *
 * So this module is the body, and `trees/sdf-crown.ts` is one caller of it.
 * Anything that wants to look as good as the chestnut asks for a `VolumeSpec`
 * and gets the same light model for free, including the parts that are easy to
 * get wrong: the fillet between lobes, the occlusion that darkens the interior,
 * and the fact that changing the light direction re-lights the whole thing
 * correctly instead of sliding a highlight around.
 *
 * Three things are deliberately parameters rather than constants, because they
 * are the knobs `lod.ts` turns for a body the player is far away from: the warp
 * octave count, the normal epsilon, and whether the normal is computed at all.
 */

import type { InkId, PixelCloud } from "../ink";
import { fbm3 } from "./noise";
import { pixelHash } from "../transforms";
import {
  rasterizeSdf,
  sdSmoothUnion,
  warpField,
  type Offset,
  type SdfField,
} from "./sdf";

export interface Lobe {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface WarpSpec {
  /** Displacement in logical pixels. Under ~1.5 is a smooth blob; over ~4 falls apart. */
  readonly amplitudeX: number;
  readonly amplitudeY: number;
  /** Domain divisor — how large the lumps are. */
  readonly scale: number;
  readonly seed: number;
  /** The noise's third axis. Advance it and the surface breathes. */
  readonly drift: number;
  /** Detail in the warp. The first thing a distant body gives up. */
  readonly octaves?: number;
}

export interface VolumeSpec {
  readonly lobes: readonly Lobe[];
  /** Fillet width where lobes meet. About a third of the smallest radius. */
  readonly weld: number;
  readonly warp?: WarpSpec;
}

export interface VolumeLight {
  readonly ramp: readonly InkId[];
  /** Screen-space, pointing from the surface toward the lamp; +y is down. */
  readonly light?: Offset;
  readonly ambient?: number;
  /** Ramp levels lost per pixel of depth into the body. The occlusion term. */
  readonly occlusion?: number;
  readonly dither?: boolean;
  readonly normalEpsilon?: number;
  /** Light from depth alone, skipping the normal's four extra evaluations. */
  readonly flat?: boolean;
  readonly meter?: { evaluations: number };
}

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The welded, warped field. Exported so a caller can subtract or union further. */
export function volumeField(spec: VolumeSpec): SdfField {
  const circles = spec.lobes.map((lobe): SdfField => {
    return (x, y) => Math.hypot(x - lobe.x, y - lobe.y) - lobe.radius;
  });
  const base = sdSmoothUnion(spec.weld, ...circles);
  if (spec.warp === undefined) {
    return base;
  }
  const warp = spec.warp;
  const octaves = warp.octaves ?? 2;
  return warpField(base, (x, y) => ({
    x: (fbm3(x / warp.scale, y / warp.scale, warp.drift, warp.seed, { octaves }) - 0.5) * warp.amplitudeX,
    y:
      (fbm3(x / warp.scale + 11, y / warp.scale - 7, warp.drift, warp.seed + 91, { octaves }) - 0.5) *
      warp.amplitudeY,
  }));
}

/**
 * The box a body can possibly occupy: its lobes' extent, plus the warp's reach
 * and the weld's fillet.
 *
 * Derived rather than authored because getting it wrong is silent in both
 * directions — too small clips the body, too large multiplies the per-pixel
 * loop by empty space, and neither shows up as anything but "slow" or "the
 * edge looks chopped".
 */
export function volumeBox(spec: VolumeSpec): Box {
  // Half the amplitude, because the warp offset is `(noise - 0.5) * amplitude`
  // and therefore reaches amplitude/2 in either direction. Padding by the whole
  // amplitude scanned a box a third larger than the body could ever fill, and
  // the box scan — not the normals — is where most of a render's time goes.
  const warpReach = Math.max(spec.warp?.amplitudeX ?? 0, spec.warp?.amplitudeY ?? 0) / 2;
  const pad = Math.ceil(warpReach + spec.weld + 2);
  const left = Math.min(...spec.lobes.map((lobe) => lobe.x - lobe.radius)) - pad;
  const right = Math.max(...spec.lobes.map((lobe) => lobe.x + lobe.radius)) + pad;
  const top = Math.min(...spec.lobes.map((lobe) => lobe.y - lobe.radius)) - pad;
  const bottom = Math.max(...spec.lobes.map((lobe) => lobe.y + lobe.radius)) + pad;
  return {
    left: Math.floor(left),
    top: Math.floor(top),
    right: Math.ceil(right),
    bottom: Math.ceil(bottom),
  };
}

/** The body as lit pixels. `clip` narrows the box — usually to the ground line. */
export function volumeCloud(spec: VolumeSpec, light: VolumeLight, clip?: Partial<Box>): PixelCloud {
  const box = { ...volumeBox(spec), ...clip };
  if (spec.lobes.length === 0 || box.right < box.left || box.bottom < box.top) {
    return [];
  }
  return rasterizeSdf(volumeField(spec), {
    box,
    ramp: light.ramp,
    light: light.light,
    ambient: light.ambient,
    occlusion: light.occlusion,
    dither: light.dither,
    normalEpsilon: light.normalEpsilon,
    flat: light.flat,
    meter: light.meter,
  });
}

/**
 * What a render of this body will cost, in field evaluations.
 *
 * Pure, and exact: the same number `meter` counts. Having it as a function
 * rather than only as a measurement is what lets the budget tests assert on
 * cost without timing anything — a wall clock in CI measures the CI machine.
 */
export function volumeCost(spec: VolumeSpec, light: VolumeLight, clip?: Partial<Box>): number {
  const box = { ...volumeBox(spec), ...clip };
  const width = Math.max(0, box.right - box.left + 1);
  const height = Math.max(0, box.bottom - box.top + 1);
  // One evaluation to test the pixel, four more for the normal if it is lit
  // from one. The inside/outside split decides how much of the box pays the
  // second cost, so this is an upper bound and the meter lands under it.
  return width * height * (light.flat === true ? 1 : 5);
}

/* ---------- lobe arrangements ---------- */

/** Lobes around an ellipse: a crown, a canopy, a cloud, a cluster of eggs. */
export function lobeRing(
  count: number,
  spread: { readonly x: number; readonly y: number; readonly radiusX: number; readonly radiusY: number },
  size: { readonly min: number; readonly max: number },
  seed: number,
): Lobe[] {
  return Array.from({ length: count }, (_unused, index) => {
    const angle = (index / count) * Math.PI * 2 + pixelHash(index, 0, seed, 2);
    return {
      x: spread.x + Math.cos(angle) * spread.radiusX * (0.55 + pixelHash(index, 0, seed, 3) * 0.45),
      y: spread.y + Math.sin(angle) * spread.radiusY * (0.55 + pixelHash(index, 0, seed, 4) * 0.45),
      radius: size.min + pixelHash(index, 0, seed, 5) * (size.max - size.min),
    };
  });
}

/**
 * Lobes along the ground: a boulder, a mound, a bank of moss.
 *
 * Squat and overlapping, with the largest in the middle, because a rock whose
 * lobes are the same size reads as a bunch of grapes.
 */
export function lobeMound(
  count: number,
  width: number,
  height: number,
  seed: number,
): Lobe[] {
  return Array.from({ length: count }, (_unused, index) => {
    const across = count === 1 ? 0 : (index / (count - 1)) * 2 - 1;
    const centrality = 1 - Math.abs(across) * 0.62;
    return {
      x: across * width * 0.5,
      y: -height * 0.42 * centrality - pixelHash(index, 0, seed, 6) * height * 0.16,
      radius: height * 0.5 * centrality + pixelHash(index, 0, seed, 7) * height * 0.14,
    };
  });
}
