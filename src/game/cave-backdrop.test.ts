import { describe, expect, it } from "vitest";

import type { BackdropView } from "./backdrop";
import { CAVE_AMBIENT, CAVE_BACKDROP, caveCeilingInk, ceilingDepth, loopNoise, torchCloud } from "./cave-backdrop";
import { PANORAMA_WIDTH } from "./panorama";
import { bufferPixel, createBuffer } from "./pixel-buffer";
import { CAVE } from "./realm";

const HEIGHT = 16;
const view = (offset: number): BackdropView => ({ width: 320, height: HEIGHT, offset, elapsedMs: 0 });

describe("the cave's roof", () => {
  it("closes on itself round the lap", () => {
    expect(loopNoise(PANORAMA_WIDTH, 40, 7)).toBeCloseTo(loopNoise(0, 40, 7), 9);
    for (let y = 0; y < HEIGHT; y += 1) {
      expect(caveCeilingInk(PANORAMA_WIDTH + 3, y, HEIGHT)).toBe(caveCeilingInk(3, y, HEIGHT));
    }
  });

  it("is rock at the top and the dark below it", () => {
    const u = 517;
    expect(caveCeilingInk(u, 0, HEIGHT)).toMatch(/^stone-/);
    const below = Math.ceil(ceilingDepth(u, HEIGHT)) + 1;
    expect(["void", "stone-0"]).toContain(caveCeilingInk(u, Math.min(below, HEIGHT - 1), HEIGHT));
  });

  it("hangs stalactites somewhere round the lap", () => {
    const depths = Array.from({ length: PANORAMA_WIDTH }, (_unused, u) => ceilingDepth(u, HEIGHT));
    const base = HEIGHT * 0.3;
    expect(depths.filter((d) => d > base + 2).length).toBeGreaterThan(10);
  });
});

describe("torchCloud", () => {
  it("flickers over time, and the same instant draws the same flame", () => {
    expect(torchCloud(400, 3)).toEqual(torchCloud(400, 3));
    const shapes = new Set([0, 200, 400, 600, 800, 1000, 1200].map((ms) => JSON.stringify(torchCloud(ms, 3))));
    expect(shapes.size).toBeGreaterThan(1);
    expect(torchCloud(0, 3).some((pixel) => pixel.ink.startsWith("fire-"))).toBe(true);
  });
});

describe("CAVE_BACKDROP", () => {
  it("is the cave, lit dimly, and gives off no light of its own", () => {
    expect(CAVE_BACKDROP.id).toBe(CAVE);
    expect(CAVE_BACKDROP.ambient).toBe(CAVE_AMBIENT);
    expect(CAVE_BACKDROP.lights(view(0))).toEqual([]);
  });

  it("paints the whole band opaque", () => {
    const buffer = createBuffer(320, HEIGHT);
    CAVE_BACKDROP.paint(buffer, view(100));
    for (let y = 0; y < HEIGHT; y += 3) {
      for (let x = 0; x < 320; x += 13) {
        expect(bufferPixel(buffer, x, y)[3]).toBe(255);
      }
    }
  });

  it("turns with the heading: a turn of the panorama is a slide of the picture", () => {
    const a = createBuffer(320, HEIGHT);
    const b = createBuffer(320, HEIGHT);
    CAVE_BACKDROP.paint(a, view(600));
    CAVE_BACKDROP.paint(b, view(610));
    for (let y = 0; y < HEIGHT; y += 1) {
      expect(bufferPixel(b, 0, y)).toEqual(bufferPixel(a, 10, y));
    }
  });

  it("asks to be repainted only when the heading moves", () => {
    expect(CAVE_BACKDROP.signature({ ...view(5), elapsedMs: 10 })).toBe(CAVE_BACKDROP.signature({ ...view(5), elapsedMs: 900 }));
    expect(CAVE_BACKDROP.signature(view(5))).not.toBe(CAVE_BACKDROP.signature(view(6)));
  });
});
