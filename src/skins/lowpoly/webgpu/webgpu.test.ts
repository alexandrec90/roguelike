import { describe, expect, it } from "vitest";

import { atmosphereAt } from "../../../game/atmosphere";
import { DEFAULT_SKY_FRACTION } from "../../../game/horizon";
import type { DrawCall, FrameUniforms } from "../backend";
import { FLAT_LOOK, PAINTED_LOOK } from "../look";
import { lowpolyView } from "../placement";
import { WORLD_FRAGMENT, WORLD_FRAGMENT_SOLID } from "../shaders";
import { DRAW_FLOATS, drawCount, FRAME_FLOATS, packDraws, packFrame } from "./uniform-pack";
import { freshImpulses, stepsFor, WAVE_WGSL } from "./wave-sim";
import { SURFACE_WGSL } from "./wave-surface";
import { MAX_WAVE_STEPS, WAVE_STEP_S } from "./waves";
import { RAIN_WGSL, SKY_WGSL, packPasses, PASSES_FLOATS } from "./wgsl-passes";
import { worldWgsl } from "./wgsl-world";

const frame: FrameUniforms = {
  view: lowpolyView(16 / 9, DEFAULT_SKY_FRACTION, 20),
  atmosphere: atmosphereAt(13),
  shake: { x: 1, y: -2 },
  water: { hero: [12.5, 40.25], level: 0.7, wetness: 0.4, rain: 0.6, seconds: 3.5, ripples: new Float32Array(64) },
  look: FLAT_LOOK,
  width: 1280,
  height: 720,
};

describe("the WebGPU uniforms", () => {
  it("lay the frame out a vec4f to a field, in the order the WGSL struct reads it", () => {
    const floats = packFrame(frame);
    expect(floats).toHaveLength(FRAME_FLOATS);
    expect([...floats.slice(0, 4)]).toEqual([frame.view.width, frame.view.height, frame.view.footX, frame.view.footY]);
    expect([...floats.slice(10, 12)]).toEqual([1, -2]);
    expect([...floats.slice(12, 16)]).toEqual([12.5, 40.25, 1280, 720]);
    expect(floats[32]).toBeCloseTo(0.7, 6);
    expect(floats[35]).toBe(3.5);
    // The hero's wave cell: eight to a tile.
    expect([...floats.slice(36, 38)]).toEqual([100, 322]);
  });

  it("tell the world shader which look to light in, in shading.w", () => {
    expect(packFrame(frame)[31]).toBe(0);
    expect(packFrame({ ...frame, look: PAINTED_LOOK })[31]).toBe(1);
  });

  it("number the draws list after list, so a list's first draw is the sum of those before it", () => {
    const call = (x: number): DrawCall => ({ drawable: { count: 3 }, offset: [x, 0], turn: Math.PI / 2 });
    const lists = [
      { calls: [call(1), call(2)], mirror: -1 },
      { calls: [call(3)], mirror: 1 },
    ];
    const floats = packDraws(lists);
    expect(drawCount(lists)).toBe(3);
    expect(floats).toHaveLength(3 * DRAW_FLOATS);
    expect(floats[DRAW_FLOATS * 2]).toBe(3);
    expect(floats[DRAW_FLOATS * 2 + 4]).toBe(1);
    expect(floats[4]).toBe(-1);
    expect(floats[3]).toBeCloseTo(1, 9);
  });

  it("pack the sky and rain block", () => {
    const floats = packPasses(frame, { strength: 0.5, seconds: 2, slant: 0.4, light: 1 });
    expect(floats).toHaveLength(PASSES_FLOATS);
    expect([...floats.slice(20, 24)]).toEqual([0.5, 2, Math.fround(0.4), 1]);
  });
});

describe("the wave simulation's frame", () => {
  it("takes whole fixed steps and carries the rest", () => {
    const plan = stepsFor(0, WAVE_STEP_S * 2.5);
    expect(plan.steps).toBe(2);
    expect(plan.carried).toBeCloseTo(WAVE_STEP_S * 0.5, 9);
    expect(stepsFor(plan.carried, WAVE_STEP_S * 0.6).steps).toBe(1);
  });

  it("caps a long frame and drops its backlog rather than running flat out after it", () => {
    const plan = stepsFor(0, 2);
    expect(plan.steps).toBe(MAX_WAVE_STEPS);
    expect(plan.carried).toBeLessThanOrEqual(WAVE_STEP_S);
  });

  it("hands each footstep to the water once", () => {
    const ripples = new Float32Array(64);
    ripples.set([3, 4, 1.25, 1], 0);
    const seen = new Float32Array(16).fill(-1);
    expect(freshImpulses(ripples, seen)).toEqual([[3, 4, 0, 1]]);
    expect(freshImpulses(ripples, seen)).toEqual([]);
    ripples.set([5, 6, 2.5, 0.7], 0);
    expect(freshImpulses(ripples, seen)).toHaveLength(1);
  });
});

describe("the shader sources", () => {
  it("give what stands on screen a build that cannot discard, so the early depth test stays on", () => {
    expect(worldWgsl(true)).toContain("discard");
    expect(worldWgsl(false)).not.toContain("discard");
    expect(WORLD_FRAGMENT).toContain("discard");
    expect(WORLD_FRAGMENT_SOLID).not.toContain("discard");
  });

  it("read the water from the simulated surface, and mirror height in the vertex stage", () => {
    const world = worldWgsl(true);
    expect(world).toContain("textureSampleLevel(waveSurface");
    expect(world).toContain("input.pos.z * mirror");
    expect(WAVE_WGSL).toContain("fn stepWaves");
    expect(SURFACE_WGSL).toContain("textureStore(surface");
    expect(SKY_WGSL).toContain("fn skyFragment");
    expect(RAIN_WGSL).toContain("fn rainFragment");
  });
});
