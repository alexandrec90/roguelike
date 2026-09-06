/**
 * Packing a `VolumeSpec` into the shader's uniforms.
 *
 * Kept apart from the WebGL calls and from the shader source because it is the
 * only part of the GPU path that can be tested without a GPU — and it is where
 * the mistakes actually are. A wrong `gl.uniform*` call throws; a lobe written
 * into the wrong slot, a ramp handed over in the wrong order, or an octave
 * count silently truncated to fit a fixed-size array all render a plausible
 * picture that is quietly not the CPU's picture.
 *
 * So this module is pure: spec in, numbers out, no context. The test asserts
 * both that it fills the arrays correctly and that the names it emits are
 * exactly the uniforms the shader declares.
 */

import { hexToRgb } from "../color";
import type { HeatGrid } from "../burnable";
import { INK_COLORS, type InkId } from "../ink";
import { INK_RAMPS } from "../shading";
import { volumeBox, type Box, type VolumeLight, type VolumeSpec } from "../procgen/volume";
import { TILE_DEPTH, TILE_WIDTH } from "../projection";
import { MAX_LOBES, MAX_OCTAVES, MAX_RAMP } from "./volume-shader";

export interface VolumeUniforms {
  readonly u_boxOrigin: readonly [number, number];
  readonly u_viewport: readonly [number, number];
  /** `MAX_LOBES` triples of (x, y, radius); unused slots are zero. */
  readonly u_lobes: Float32Array;
  /** `MAX_LOBES` triples of (toX, toY, isCapsule); a disc's third is zero. */
  readonly u_lobeEnds: Float32Array;
  readonly u_lobeCount: number;
  readonly u_weld: number;
  readonly u_warpOn: number;
  readonly u_warpAmplitude: readonly [number, number];
  readonly u_warpScale: number;
  readonly u_warpDrift: number;
  readonly u_warpSeed: number;
  readonly u_warpOctaves: number;
  /** `MAX_RAMP` RGB triples in 0..1, darkest first, as `INK_RAMPS` orders them. */
  readonly u_ramp: Float32Array;
  readonly u_rampSteps: number;
  readonly u_light: readonly [number, number];
  readonly u_ambient: number;
  readonly u_occlusion: number;
  readonly u_normalEpsilon: number;
  readonly u_flat: number;
  readonly u_dither: number;
  readonly u_shadowOn: number;
  readonly u_shadowSpread: number;
  readonly u_shadowSlope: number;
  readonly u_shadowSquash: number;
  readonly u_shadowSoftness: number;
  readonly u_shadowSeed: number;
  readonly u_heatOn: number;
  readonly u_heat: number;
  readonly u_heatOrigin: readonly [number, number];
  readonly u_heatSize: readonly [number, number];
  readonly u_heatCell: number;
  readonly u_emberRamp: Float32Array;
  readonly u_emberSteps: number;
  readonly u_charColor: readonly [number, number, number];
  readonly u_heatFlicker: number;
}

/** The palette, as the shader wants it: 0..1 floats, darkest step first. */
export function packRamp(ramp: readonly InkId[]): Float32Array {
  if (ramp.length === 0) {
    throw new Error("A ramp needs at least one ink");
  }
  if (ramp.length > MAX_RAMP) {
    throw new Error(`A ramp of ${ramp.length} inks exceeds the shader's ${MAX_RAMP}`);
  }
  const packed = new Float32Array(MAX_RAMP * 3);
  ramp.forEach((ink, index) => {
    const { r, g, b } = hexToRgb(INK_COLORS[ink]);
    packed[index * 3] = r / 255;
    packed[index * 3 + 1] = g / 255;
    packed[index * 3 + 2] = b / 255;
  });
  return packed;
}

interface PackedLobes {
  readonly lobes: Float32Array;
  readonly ends: Float32Array;
}

/**
 * Lobes and their end points, in two parallel arrays.
 *
 * Two arrays rather than one `vec4` pair because the shape a lobe *is* — disc
 * or capsule — has to survive the trip, and a sentinel radius or a NaN would be
 * a rule the shader and this file could each remember differently. The third
 * component of `ends` says which, in one place.
 */
function packLobes(spec: VolumeSpec): PackedLobes {
  if (spec.lobes.length > MAX_LOBES) {
    throw new Error(`A body of ${spec.lobes.length} lobes exceeds the shader's ${MAX_LOBES}`);
  }
  const lobes = new Float32Array(MAX_LOBES * 3);
  const ends = new Float32Array(MAX_LOBES * 3);
  spec.lobes.forEach((lobe, index) => {
    lobes[index * 3] = lobe.x;
    lobes[index * 3 + 1] = lobe.y;
    lobes[index * 3 + 2] = lobe.radius;
    const capsule = lobe.toX !== undefined && lobe.toY !== undefined;
    ends[index * 3] = lobe.toX ?? lobe.x;
    ends[index * 3 + 1] = lobe.toY ?? lobe.y;
    ends[index * 3 + 2] = capsule ? 1 : 0;
  });
  return { lobes, ends };
}

/**
 * Every uniform the shader needs for one body.
 *
 * `box` is in cloud coordinates and inclusive on both edges, exactly as
 * `volumeBox` returns it, so the viewport is one pixel larger than the span.
 */
type WarpUniforms = Pick<
  VolumeUniforms,
  "u_warpOn" | "u_warpAmplitude" | "u_warpScale" | "u_warpDrift" | "u_warpSeed" | "u_warpOctaves"
>;

function packWarp(spec: VolumeSpec): WarpUniforms {
  const warp = spec.warp;
  const octaves = warp?.octaves ?? 2;
  if (octaves > MAX_OCTAVES) {
    // Truncating here would draw a smoother body than the CPU's and call it the
    // same thing, which is the exact failure this whole port exists to avoid.
    throw new Error(`A warp of ${octaves} octaves exceeds the shader's ${MAX_OCTAVES}`);
  }
  return {
    u_warpOn: warp === undefined ? 0 : 1,
    u_warpAmplitude: [warp?.amplitudeX ?? 0, warp?.amplitudeY ?? 0],
    u_warpScale: warp?.scale ?? 1,
    u_warpDrift: warp?.drift ?? 0,
    // Truncated, not rounded: the CPU passes the seed straight into `pixelHash`,
    // which coerces through a bitwise op and therefore truncates too.
    u_warpSeed: Math.trunc(warp?.seed ?? 0),
    u_warpOctaves: octaves,
  };
}

type LightUniforms = Pick<
  VolumeUniforms,
  "u_ramp" | "u_rampSteps" | "u_light" | "u_ambient" | "u_occlusion" | "u_normalEpsilon" | "u_flat" | "u_dither"
>;

/** Every default here is the CPU rasteriser's, and has to stay that way. */
function packLight(light: VolumeLight): LightUniforms {
  const direction = light.light ?? { x: -0.6, y: -0.8 };
  return {
    u_ramp: packRamp(light.ramp),
    u_rampSteps: light.ramp.length,
    u_light: [direction.x, direction.y],
    u_ambient: light.ambient ?? 0.15,
    u_occlusion: light.occlusion ?? 0.06,
    u_normalEpsilon: light.normalEpsilon ?? 0.6,
    u_flat: light.flat === true ? 1 : 0,
    u_dither: (light.dither ?? true) ? 1 : 0,
  };
}

/** How the ground reads a body's shadow, matching `castShadow`'s constants. */
export interface VolumeShadow {
  readonly light: { readonly x: number; readonly y: number };
  readonly elevation?: number;
  readonly softness?: number;
  readonly seed?: number;
}

/** The foreshortening `castShadow` applies, kept in one place on both paths. */
export const SHADOW_SQUASH = (TILE_DEPTH / TILE_WIDTH) * 0.45;
const MAX_SHADOW_REACH = 26;

type ShadowUniforms = Pick<
  VolumeUniforms,
  | "u_shadowOn"
  | "u_shadowSpread"
  | "u_shadowSlope"
  | "u_shadowSquash"
  | "u_shadowSoftness"
  | "u_shadowSeed"
>;

const NO_SHADOW: ShadowUniforms = {
  u_shadowOn: 0,
  u_shadowSpread: 0,
  u_shadowSlope: 0,
  u_shadowSquash: SHADOW_SQUASH,
  u_shadowSoftness: 0,
  u_shadowSeed: 0,
};

/**
 * The shadow's terms, derived exactly as `castShadow` derives them — including
 * the cap applied to the *tallest* pixel so everything below scales under it
 * rather than being clamped flat.
 */
export function shadowUniforms(spec: VolumeSpec, shadow: VolumeShadow): ShadowUniforms {
  const elevation = Math.max(shadow.elevation ?? 0.55, 0.05);
  const length = Math.hypot(shadow.light.x, shadow.light.y) || 1;
  const slope = -(shadow.light.x / length) / elevation;
  const tallest = Math.max(1, -volumeBox(spec).top);
  const spread = Math.min((tallest / elevation) * 0.35, MAX_SHADOW_REACH) / tallest;
  return {
    u_shadowOn: 1,
    u_shadowSpread: spread,
    // Folded together because the shader only ever needs the product.
    u_shadowSlope: slope * elevation,
    u_shadowSquash: SHADOW_SQUASH,
    u_shadowSoftness: Math.min(Math.max(shadow.softness ?? 0.7, 0), 1),
    u_shadowSeed: shadow.seed ?? 0x5ad0,
  };
}

/**
 * The patch of ground a body's shadow can reach.
 *
 * A different box from the body's: it starts at the foot and runs downwind, so
 * rendering a shadow means rendering a different rectangle of the same field.
 */
export function shadowBox(spec: VolumeSpec, shadow: VolumeShadow): Box {
  const terms = shadowUniforms(spec, shadow);
  const body = volumeBox(spec);
  const maxReach = Math.max(1, -body.top) * terms.u_shadowSpread;
  const shift = maxReach * terms.u_shadowSlope;
  return {
    left: Math.floor(Math.min(body.left, body.left + shift)) - 1,
    right: Math.ceil(Math.max(body.right, body.right + shift)) + 1,
    top: 0,
    bottom: Math.ceil(maxReach * terms.u_shadowSquash) + 1,
  };
}

type BurnUniforms = Pick<
  VolumeUniforms,
  | "u_heatOn"
  | "u_heat"
  | "u_heatOrigin"
  | "u_heatSize"
  | "u_heatCell"
  | "u_emberRamp"
  | "u_emberSteps"
  | "u_charColor"
  | "u_heatFlicker"
>;

/** The texture unit the heat grid is bound to. Only one sampler exists. */
export const HEAT_TEXTURE_UNIT = 0;

function charColor(): [number, number, number] {
  const { r, g, b } = hexToRgb(INK_COLORS.deep);
  return [r / 255, g / 255, b / 255];
}

const NO_BURN: BurnUniforms = {
  u_heatOn: 0,
  u_heat: HEAT_TEXTURE_UNIT,
  u_heatOrigin: [0, 0],
  u_heatSize: [1, 1],
  u_heatCell: 1,
  u_emberRamp: packRamp(INK_RAMPS.ember),
  u_emberSteps: INK_RAMPS.ember.length,
  u_charColor: charColor(),
  u_heatFlicker: 0,
};

/**
 * The fire's uniforms. `elapsedMs` only picks the flicker's salt, exactly as
 * `burnInk` does, so the two paths flicker in step.
 */
export function burnUniforms(grid: HeatGrid, elapsedMs: number, seed: number): BurnUniforms {
  return {
    ...NO_BURN,
    u_heatOn: 1,
    u_heatOrigin: [grid.originX, grid.originY],
    u_heatSize: [grid.width, grid.height],
    u_heatCell: grid.cellSize,
    u_heatFlicker: Math.trunc(seed + Math.floor(elapsedMs / 90)),
  };
}

export function volumeUniforms(
  spec: VolumeSpec,
  light: VolumeLight,
  box: Box,
  shadow?: VolumeShadow,
  burn?: BurnUniforms,
): VolumeUniforms {
  const width = box.right - box.left + 1;
  const height = box.bottom - box.top + 1;
  if (width < 1 || height < 1) {
    throw new Error("A volume box must contain at least one pixel");
  }

  const packed = packLobes(spec);
  return {
    u_boxOrigin: [box.left, box.top],
    u_viewport: [width, height],
    u_lobes: packed.lobes,
    u_lobeEnds: packed.ends,
    u_lobeCount: spec.lobes.length,
    u_weld: spec.weld,
    ...packWarp(spec),
    ...packLight(light),
    ...(shadow === undefined ? NO_SHADOW : shadowUniforms(spec, shadow)),
    ...(burn ?? NO_BURN),
  };
}
