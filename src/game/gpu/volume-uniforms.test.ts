import { describe, expect, it } from "vitest";

import { hexToRgb } from "../color";
import { INK_COLORS } from "../ink";
import { volumeBox, type VolumeLight, type VolumeSpec } from "../procgen/volume";
import { INK_RAMPS } from "../shading";
import {
  declaredUniforms,
  MAX_LOBES,
  MAX_OCTAVES,
  MAX_RAMP,
  VOLUME_FRAGMENT_SHADER,
  VOLUME_VERTEX_SHADER,
} from "./volume-shader";
import {
  packRamp,
  SHADOW_SQUASH,
  shadowBox,
  shadowUniforms,
  volumeUniforms,
} from "./volume-uniforms";

const SPEC: VolumeSpec = {
  lobes: [
    { x: -3, y: -10, radius: 5 },
    { x: 4, y: -12, radius: 6 },
  ],
  weld: 2,
  warp: { amplitudeX: 4, amplitudeY: 3, scale: 5, seed: 0x7e31, drift: 1.5, octaves: 2 },
};
const LIGHT: VolumeLight = { ramp: INK_RAMPS.canopy, light: { x: -0.6, y: -0.8 } };
const BOX = volumeBox(SPEC);

describe("the shader source", () => {
  it("declares GLSL ES 3.00 on its very first line, as WebGL2 requires", () => {
    expect(VOLUME_FRAGMENT_SHADER.startsWith("#version 300 es\n")).toBe(true);
    expect(VOLUME_VERTEX_SHADER.startsWith("#version 300 es\n")).toBe(true);
  });

  it("sizes its uniform arrays from the exported bounds", () => {
    expect(VOLUME_FRAGMENT_SHADER).toContain(`u_lobes[${MAX_LOBES}]`);
    expect(VOLUME_FRAGMENT_SHADER).toContain(`u_ramp[${MAX_RAMP}]`);
    expect(VOLUME_FRAGMENT_SHADER).toContain(`octave < ${MAX_OCTAVES}`);
  });

  it("never names a local after a GLSL reserved word", () => {
    // A shader only reports this at compile time, in a browser, as a blank
    // canvas — `sample` as a loop counter cost a round trip to find. The list is
    // the GLSL ES 3.00 reserved words a JavaScript author would reach for
    // without a second thought.
    const reserved = ["sample", "filter", "input", "output", "buffer", "shared", "resource", "patch"];
    for (const word of reserved) {
      const declaration = new RegExp(`\\b(int|float|vec[234]|bool)\\s+${word}\\b`);
      expect(declaration.test(VOLUME_FRAGMENT_SHADER), `'${word}' is reserved in GLSL`).toBe(false);
    }
  });

  it("ports the CPU hash's constants rather than inventing a shader hash", () => {
    // The whole point of the port: a `fract(sin(dot(...)))` hash would be a
    // different lattice and therefore a visibly different tree.
    for (const constant of ["0x9e3779b9u", "0x27d4eb2du", "0x85ebca6bu"]) {
      expect(VOLUME_FRAGMENT_SHADER).toContain(constant);
    }
    expect(VOLUME_FRAGMENT_SHADER).not.toContain("43758.5453");
  });
});

describe("the uniform names", () => {
  it("are exactly the ones the packer sets", () => {
    // A misspelled uniform is silently ignored by getUniformLocation, so it
    // renders a plausible wrong picture instead of failing. This is the one
    // shader bug catchable without a GPU, so it is caught here.
    const declared = new Set(declaredUniforms());
    const packed = new Set(Object.keys(volumeUniforms(SPEC, LIGHT, BOX)));
    expect([...packed].sort()).toEqual([...declared].sort());
  });
});

describe("the shadow terms", () => {
  const SUN = { light: { x: -1, y: -0.5 } };

  it("leans the shadow away from the light, and the other way when it moves", () => {
    const left = shadowUniforms(SPEC, SUN).u_shadowSlope;
    const right = shadowUniforms(SPEC, { light: { x: 1, y: -0.5 } }).u_shadowSlope;
    expect(left).toBeGreaterThan(0);
    expect(right).toBeLessThan(0);
  });

  it("scales the whole shadow under a cap rather than clamping it flat", () => {
    // The same property the CPU regression pins: cap the tallest pixel, and let
    // everything below scale under it, or the shadow collapses onto one row.
    const low = shadowUniforms(SPEC, { ...SUN, elevation: 0.2 }).u_shadowSpread;
    const high = shadowUniforms(SPEC, { ...SUN, elevation: 1 }).u_shadowSpread;
    expect(low).toBeGreaterThan(high);
    expect(low).toBeLessThanOrEqual(26);
  });

  it("boxes the ground the shadow can reach, starting at the foot", () => {
    const box = shadowBox(SPEC, SUN);
    expect(box.top).toBe(0);
    expect(box.bottom).toBeGreaterThan(0);
    // Downwind of a light from the left, so the box must extend to the right.
    expect(box.right).toBeGreaterThan(volumeBox(SPEC).right);
  });

  it("uses the same foreshortening the ground itself does", () => {
    expect(SHADOW_SQUASH).toBeCloseTo((12 / 16) * 0.45, 10);
  });
});

describe("packing a ramp", () => {
  it("writes darkest-first RGB in 0..1", () => {
    const packed = packRamp(INK_RAMPS.canopy);
    const first = hexToRgb(INK_COLORS[INK_RAMPS.canopy[0]!]);
    expect(packed[0]).toBeCloseTo(first.r / 255, 6);
    expect(packed[1]).toBeCloseTo(first.g / 255, 6);
    expect(packed[2]).toBeCloseTo(first.b / 255, 6);
  });

  it("pads to the shader's fixed size, leaving unused slots black", () => {
    const packed = packRamp(INK_RAMPS.canopy);
    expect(packed).toHaveLength(MAX_RAMP * 3);
    expect(packed[MAX_RAMP * 3 - 1]).toBe(0);
  });

  it("refuses an empty ramp or one the shader cannot hold", () => {
    expect(() => packRamp([])).toThrow(/at least one ink/);
    expect(() => packRamp(Array.from({ length: MAX_RAMP + 1 }, () => "bone" as const))).toThrow(
      /exceeds the shader/,
    );
  });
});

describe("packing a body", () => {
  it("derives the viewport from the inclusive box", () => {
    const uniforms = volumeUniforms(SPEC, LIGHT, BOX);
    expect(uniforms.u_boxOrigin).toEqual([BOX.left, BOX.top]);
    expect(uniforms.u_viewport).toEqual([BOX.right - BOX.left + 1, BOX.bottom - BOX.top + 1]);
  });

  it("writes each lobe as a triple and reports how many are real", () => {
    const uniforms = volumeUniforms(SPEC, LIGHT, BOX);
    expect(uniforms.u_lobeCount).toBe(2);
    expect([...uniforms.u_lobes.slice(0, 6)]).toEqual([-3, -10, 5, 4, -12, 6]);
    expect(uniforms.u_lobes).toHaveLength(MAX_LOBES * 3);
    expect(uniforms.u_lobes[6]).toBe(0);
  });

  it("carries the warp across, and switches it off when there is none", () => {
    const warped = volumeUniforms(SPEC, LIGHT, BOX);
    expect(warped.u_warpOn).toBe(1);
    expect(warped.u_warpAmplitude).toEqual([4, 3]);
    expect(warped.u_warpScale).toBe(5);
    expect(warped.u_warpDrift).toBe(1.5);
    expect(warped.u_warpSeed).toBe(0x7e31);

    const plain = volumeUniforms({ lobes: SPEC.lobes, weld: 2 }, LIGHT, BOX);
    expect(plain.u_warpOn).toBe(0);
  });

  it("mirrors the CPU defaults for anything the light leaves out", () => {
    const uniforms = volumeUniforms(SPEC, { ramp: INK_RAMPS.bone }, BOX);
    expect(uniforms.u_ambient).toBe(0.15);
    expect(uniforms.u_occlusion).toBe(0.06);
    expect(uniforms.u_normalEpsilon).toBe(0.6);
    expect(uniforms.u_dither).toBe(1);
    expect(uniforms.u_flat).toBe(0);
    expect(uniforms.u_light).toEqual([-0.6, -0.8]);
  });

  it("passes the detail flags through as the ints the shader reads", () => {
    const uniforms = volumeUniforms(SPEC, { ...LIGHT, flat: true, dither: false }, BOX);
    expect(uniforms.u_flat).toBe(1);
    expect(uniforms.u_dither).toBe(0);
  });

  it("refuses a body the shader cannot hold, rather than truncating it", () => {
    // Truncating would draw a simpler body than the CPU's and call it the same
    // thing, which is the failure the whole port exists to avoid.
    const tooMany: VolumeSpec = {
      lobes: Array.from({ length: MAX_LOBES + 1 }, (_unused, index) => ({
        x: index,
        y: 0,
        radius: 2,
      })),
      weld: 1,
    };
    expect(() => volumeUniforms(tooMany, LIGHT, volumeBox(tooMany))).toThrow(/exceeds the shader/);

    const deep: VolumeSpec = {
      ...SPEC,
      warp: { ...SPEC.warp!, octaves: MAX_OCTAVES + 1 },
    };
    expect(() => volumeUniforms(deep, LIGHT, BOX)).toThrow(/octaves exceeds the shader/);
  });

  it("leaves the shadow pass off unless one is asked for", () => {
    expect(volumeUniforms(SPEC, LIGHT, BOX).u_shadowOn).toBe(0);
    expect(volumeUniforms(SPEC, LIGHT, BOX, { light: { x: -1, y: -0.5 } }).u_shadowOn).toBe(1);
  });

  it("refuses an empty box", () => {
    expect(() => volumeUniforms(SPEC, LIGHT, { left: 5, top: 0, right: 4, bottom: 0 })).toThrow(
      /at least one pixel/,
    );
  });
});
