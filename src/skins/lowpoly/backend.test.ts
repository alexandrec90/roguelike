import { describe, expect, it } from "vitest";

import { DEFAULT_SKY_FRACTION } from "../../game/horizon";
import { backendOrder, parseGpu, parseMsaa } from "./backend";
import { backingSize, fieldRows, lowpolyView, MAX_DRAWN_PIXELS } from "./placement";
import { CHUNK_TILES, groundInView, MIRROR_ROWS } from "./world-chunks";

describe("choosing a backend", () => {
  it("prefers WebGPU and always keeps WebGL2 behind it", () => {
    expect(backendOrder("auto", true)).toEqual(["webgpu", "webgl"]);
    expect(backendOrder("webgpu", true)).toEqual(["webgpu", "webgl"]);
  });

  it("goes straight to WebGL2 when asked, or when the browser has no WebGPU", () => {
    expect(backendOrder("webgl", true)).toEqual(["webgl"]);
    expect(backendOrder("auto", false)).toEqual(["webgl"]);
    expect(backendOrder("webgpu", false)).toEqual(["webgl"]);
  });

  it("reads ?gpu= and ?msaa=, falling back on anything else", () => {
    expect(parseGpu(" WebGPU ")).toBe("webgpu");
    expect(parseGpu("webgl")).toBe("webgl");
    expect(parseGpu("vulkan")).toBe("auto");
    expect(parseGpu(null)).toBe("auto");
    expect(parseMsaa("1")).toBe(1);
    expect(parseMsaa("8")).toBe(4);
    expect(parseMsaa(null)).toBe(4);
  });
});

describe("the drawing buffer", () => {
  it("is the window at its pixel ratio while that fits the budget", () => {
    expect(backingSize(1280, 720, 1)).toEqual({ width: 1280, height: 720 });
  });

  it("is drawn smaller past the budget, keeping its shape", () => {
    const size = backingSize(3840, 2160, 2);
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_DRAWN_PIXELS * 1.01);
    expect(size.width / size.height).toBeCloseTo(16 / 9, 2);
  });
});

describe("culling the ground", () => {
  const rows = fieldRows(lowpolyView(16 / 9, DEFAULT_SKY_FRACTION, 20));

  it("keeps ground under the hero and on the lip, and skips what is past the horizon or behind the screen", () => {
    expect(groundInView({ x: -16, y: -16 }, 0, rows)).toBe(true);
    expect(groundInView({ x: -16, y: 40 }, 0, rows)).toBe(true);
    expect(groundInView({ x: -16, y: 90 }, 0, rows)).toBe(false);
    expect(groundInView({ x: -16, y: -40 - CHUNK_TILES }, 0, rows)).toBe(false);
  });

  it("turns with the world: a chunk to the side comes ahead as the hero turns toward it", () => {
    expect(groundInView({ x: 90, y: -16 }, 0, rows)).toBe(true);
    expect(groundInView({ x: 90, y: -16 }, Math.PI / 2, rows)).toBe(false);
  });

  it("draws into the mirror only what is near enough to be reflected in sight", () => {
    expect(groundInView({ x: -16, y: 40 }, 0, rows, MIRROR_ROWS)).toBe(false);
    expect(groundInView({ x: -16, y: 0 }, 0, rows, MIRROR_ROWS)).toBe(true);
  });
});
