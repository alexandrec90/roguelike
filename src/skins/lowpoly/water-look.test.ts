import { describe, expect, it } from "vitest";

import { DEFAULT_SKY_FRACTION } from "../../game/horizon";
import { TILE_WIDTH } from "../../game/projection";
import { LOWPOLY } from "./palette";
import { fieldRows, lowpolyView } from "./placement";
import { WORLD_FRAGMENT } from "./shaders";
import { WATER_DEEP_ARGS, WATER_LOOK } from "./water-glsl";
import { WAVE_DAMP, WAVE_N, WAVE_RES, WAVE_SPEED, WAVE_STEP_S } from "./webgpu/waves";
import { worldWgsl } from "./webgpu/wgsl-world";

/** The source of one shader function, from its signature to the closing brace at column 0. */
function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf("\n}", start));
}

describe("the water's look", () => {
  it("is mostly the water's own body, with the sky over it, never a near-total mirror", () => {
    expect(WATER_LOOK.reflect).toBeLessThanOrEqual(0.5);
    expect(WATER_LOOK.lakeDeep).toBeGreaterThan(WATER_LOOK.puddleDeep);
  });

  it("takes its deep colour from the palette, in both backends", () => {
    const args = WATER_DEEP_ARGS.split(", ").map(Number);
    LOWPOLY.waterDeep.forEach((channel, index) => expect(args[index]).toBeCloseTo(channel, 12));
    expect(WORLD_FRAGMENT).toContain(`const vec3 WATER_DEEP = vec3(${WATER_DEEP_ARGS});`);
    expect(worldWgsl(true)).toContain(`const WATER_DEEP = vec3f(${WATER_DEEP_ARGS});`);
  });

  it("shows a wave by its slope, never brightens a crest for its height", () => {
    // A crest painted brighter for how high it stands is what read as molten metal.
    const wgsl = functionBody(worldWgsl(true), "fn waterColour(");
    expect(wgsl).not.toMatch(/wave\.z/);
    expect(wgsl).toContain("SHEEN * slope.y");
    const glsl = functionBody(WORLD_FRAGMENT, "vec3 waterColour(");
    expect(glsl).not.toMatch(/crest/);
    expect(glsl).toContain("SHEEN * slope.y");
  });

  it("spreads a drop well out before the damping halves it, so it shows as a ring rather than a dent", () => {
    const halfLifeS = (Math.log(0.5) / Math.log(WAVE_DAMP)) * WAVE_STEP_S;
    expect(WAVE_SPEED * halfLifeS).toBeGreaterThan(1.5);
  });

  it("simulates finely enough for a thin ring, over the whole flat field", () => {
    // At 8 cells a tile a footstep's wake was fat bulges: molten metal.
    expect(WAVE_RES).toBeGreaterThanOrEqual(16);
    const reach = (WAVE_N / 2 - 2) / WAVE_RES;
    for (const aspect of [4 / 3, 16 / 9, 21 / 9]) {
      const view = lowpolyView(aspect, DEFAULT_SKY_FRACTION, 20);
      const rows = fieldRows(view);
      expect(reach).toBeGreaterThan(Math.max(rows.ahead, rows.behind));
      expect(reach).toBeGreaterThan(view.width / 2 / TILE_WIDTH);
    }
  });
});
