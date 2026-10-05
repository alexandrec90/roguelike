/**
 * The trip in the shader sources. Node compiles neither dialect, so these read
 * the text: that every term is wired where it belongs, and that no name in it
 * is one a GPU compiler refuses - the failure that only shows as a black canvas.
 */

import { describe, expect, it } from "vitest";

import { WORLD_FRAGMENT, WORLD_FRAGMENT_SOLID, WORLD_VERTEX } from "./shaders";
import { TRAIL_FRAGMENT } from "./trail-pass";
import { TRIP_GLSL, TRIP_WGSL } from "./trip-shaders";
import { TRAIL_WGSL } from "./webgpu/trail-gpu";
import { worldWgsl } from "./webgpu/wgsl-world";

// `cast` blacked the screen once. Words reserved in GLSL ES 3.00, WGSL, or both.
const RESERVED = new Set([
  "cast", "input", "output", "filter", "class", "enum", "union", "half", "fixed",
  "sample", "common", "active", "partition", "namespace", "using", "template", "this",
]);

const declared = (source: string): string[] =>
  [...source.matchAll(/\b(?:let|var|float|vec[234]f?|f32)\s+([A-Za-z_]\w*)/g)].map((match) => match[1] as string);

describe("the trip's shader sources", () => {
  it("declare nothing under a word either dialect reserves", () => {
    for (const source of [TRIP_GLSL, TRIP_WGSL, TRAIL_FRAGMENT, TRAIL_WGSL]) {
      const names = declared(source);
      expect(names.length).toBeGreaterThan(3);
      expect(names.filter((name) => RESERVED.has(name))).toEqual([]);
    }
  });

  it("write every term in both dialects", () => {
    for (const term of ["tripSwell", "tripBreath", "tripCurl", "tripColour", "tripHaze", "tripNeon"]) {
      expect(TRIP_GLSL).toContain(`${term}(`);
      expect(TRIP_WGSL).toContain(`fn ${term}(`);
    }
  });
});

describe("the GLSL world", () => {
  it("reads the swell and the curl at the foot, and flips the overhead world about the line", () => {
    expect(WORLD_VERTEX).toContain(TRIP_GLSL);
    expect(WORLD_VERTEX).toContain("tripSwell(away + u_hero)");
    expect(WORLD_VERTEX).toContain("tripCurl(foot.x)");
    expect(WORLD_VERTEX).toContain("uniform float u_flip");
  });

  it("colours the haze, then the face, then lays the neon over it", () => {
    for (const fragment of [WORLD_FRAGMENT, WORLD_FRAGMENT_SOLID]) {
      const haze = fragment.indexOf("tripHaze(u_haze");
      const colour = fragment.indexOf("tripColour(colour, v_away");
      const neon = fragment.indexOf("tripNeon(n, v_away");
      expect(haze).toBeGreaterThan(0);
      expect(colour).toBeGreaterThan(haze);
      expect(neon).toBeGreaterThan(colour);
    }
  });
});

describe("the WGSL world", () => {
  it("reads the frame's trip field, and the flip from the draw", () => {
    for (const source of [worldWgsl(true), worldWgsl(false)]) {
      expect(source).toContain(TRIP_WGSL);
      expect(source).toContain("trip: vec4f");
      expect(source).toContain("let flip = draw.mirror.y");
      expect(source).toContain("tripColour(colour, input.away");
      expect(source).toContain("tripNeon(n, input.away");
    }
  });
});
