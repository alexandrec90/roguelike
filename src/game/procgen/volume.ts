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
  sdCapsule,
  sdSmoothUnion,
  warpField,
  type Offset,
  type SdfField,
} from "./sdf";

/**
 * One blob of a body: a disc, or a capsule when an end point is given.
 *
 * The capsule is what lets a trunk, a limb, a bone or a pipe live in the same
 * body as the round parts, so an object is one field rather than a volume plus
 * some line art drawn beside it. That matters more than it sounds: only a
 * single field can be smooth-unioned, lit from one normal, and handed whole to
 * the GPU.
 */
export interface Lobe {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** With `toY`, the far end of a capsule. Without, the lobe is a disc. */
  readonly toX?: number;
  readonly toY?: number;
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
  const parts = spec.lobes.map((lobe): SdfField => {
    if (lobe.toX === undefined || lobe.toY === undefined) {
      return (x, y) => Math.hypot(x - lobe.x, y - lobe.y) - lobe.radius;
    }
    return sdCapsule(lobe.x, lobe.y, lobe.toX, lobe.toY, lobe.radius);
  });
  const base = sdSmoothUnion(spec.weld, ...parts);
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
  // Both ends of a capsule, or the same point twice for a disc.
  const xs = spec.lobes.flatMap((lobe) => [lobe.x, lobe.toX ?? lobe.x]);
  const ys = spec.lobes.flatMap((lobe) => [lobe.y, lobe.toY ?? lobe.y]);
  const radii = spec.lobes.flatMap((lobe) => [lobe.radius, lobe.radius]);
  const left = Math.min(...xs.map((x, index) => x - (radii[index] ?? 0))) - pad;
  const right = Math.max(...xs.map((x, index) => x + (radii[index] ?? 0))) + pad;
  const top = Math.min(...ys.map((y, index) => y - (radii[index] ?? 0))) - pad;
  const bottom = Math.max(...ys.map((y, index) => y + (radii[index] ?? 0))) + pad;
  return {
    left: Math.floor(left),
    top: Math.floor(top),
    right: Math.ceil(right),
    bottom: Math.ceil(bottom),
  };
}

/** A cloud-space box in screen pixels, rounded outward so nothing is clipped. */
export function scaleBox(box: Box, scale: number): Box {
  return {
    left: Math.floor(box.left * scale),
    top: Math.floor(box.top * scale),
    right: Math.ceil(box.right * scale),
    bottom: Math.ceil(box.bottom * scale),
  };
}

/**
 * The body as lit pixels. `clip` narrows the box — usually to the ground line.
 *
 * `scale` is screen pixels per cloud pixel, 1 in the flat field and under 1 on
 * the horizon roll. A scaled body is **the same field sampled at a different
 * spacing** — every screen pixel evaluates the description at its own point —
 * never a rasterised body shrunk afterwards, which would resample and is the
 * thing the pixel contract forbids. Only the sampling changes: occlusion and
 * the normal's epsilon stay in cloud units, so a body is lit the same at every
 * size, and the dither stays locked to the screen pixel it is drawn on.
 */
export function volumeCloud(
  spec: VolumeSpec,
  light: VolumeLight,
  clip?: Partial<Box>,
  scale = 1,
): PixelCloud {
  if (!(scale > 0)) {
    throw new Error("A volume scale must be positive");
  }
  const box = { ...volumeBox(spec), ...clip };
  if (spec.lobes.length === 0 || box.right < box.left || box.bottom < box.top) {
    return [];
  }
  const field = volumeField(spec);
  return rasterizeSdf(scale === 1 ? field : (x, y) => field(x / scale, y / scale), {
    box: scale === 1 ? box : scaleBox(box, scale),
    ramp: light.ramp,
    light: light.light,
    ambient: light.ambient,
    occlusion: light.occlusion,
    dither: light.dither,
    // Resolved here rather than left to the rasteriser's default, because the
    // default is in cloud units and the rasteriser is now walking screen pixels.
    normalEpsilon: (light.normalEpsilon ?? 0.6) * scale,
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
