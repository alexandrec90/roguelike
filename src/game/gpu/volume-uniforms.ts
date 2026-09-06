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
import { INK_COLORS, type InkId } from "../ink";
import type { Box, VolumeLight, VolumeSpec } from "../procgen/volume";
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

export function volumeUniforms(spec: VolumeSpec, light: VolumeLight, box: Box): VolumeUniforms {
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
  };
}
