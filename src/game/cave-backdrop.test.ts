import { describe, expect, it } from "vitest";

import type { BackdropView } from "./backdrop";
import {
  CAVE_AMBIENT,
  CAVE_BACKDROP,
  caveWallInk,
  ceilingDepth,
  loopNoise,
  rubbleHeight,
  TORCH_COUNT,
  torchCloud,
  torchColumn,
} from "./cave-backdrop";
import { PANORAMA_WIDTH } from "./panorama";
import { bufferPixel, createBuffer } from "./pixel-buffer";
import { CAVE } from "./realm";

const HEIGHT = 40;
const view = (offset: number, elapsedMs = 0): BackdropView => ({ width: 320, height: HEIGHT, offset, elapsedMs });

describe("the cave wall", () => {
  it("closes on itself round the lap", () => {
    expect(loopNoise(PANORAMA_WIDTH, 40, 7)).toBeCloseTo(loopNoise(0, 40, 7), 9);
    for (let y = 0; y < HEIGHT; y += 1) {
      expect(caveWallInk(PANORAMA_WIDTH + 3, y, HEIGHT)).toBe(caveWallInk(3, y, HEIGHT));
    }
    expect(Math.abs(ceilingDepth(PANORAMA_WIDTH - 1, HEIGHT) - ceilingDepth(0, HEIGHT))).toBeLessThan(14);
  });

  it("has rock overhead, stone in the middle and rubble at its foot", () => {
    const u = 517;
    expect(ceilingDepth(u, HEIGHT)).toBeGreaterThanOrEqual(HEIGHT * 0.08);
    expect(["stone-0", "stone-1"]).toContain(caveWallInk(u, 0, HEIGHT));
    expect(caveWallInk(u, HEIGHT - 1, HEIGHT)).toMatch(/^(earth|stone)-/);
    expect(rubbleHeight(u, HEIGHT)).toBeGreaterThanOrEqual(1);
    const middle = caveWallInk(u, Math.round(HEIGHT * 0.6), HEIGHT);
    expect(middle).toMatch(/^(stone|moss)-/);
  });

  it("hangs stalactites somewhere round the lap", () => {
    const base = HEIGHT * 0.2;
    const hanging = Array.from({ length: PANORAMA_WIDTH }, (_unused, u) => ceilingDepth(u, HEIGHT)).filter((d) => d > base + 2);
    expect(hanging.length).toBeGreaterThan(10);
  });
});

describe("torches", () => {
  it("spread round the lap, each at its own column", () => {
    const columns = Array.from({ length: TORCH_COUNT }, (_unused, index) => torchColumn(index));
    expect(new Set(columns).size).toBe(TORCH_COUNT);
    for (const column of columns) {
      expect(column).toBeGreaterThanOrEqual(0);
      expect(column).toBeLessThan(PANORAMA_WIDTH);
    }
  });

  it("flicker over time, and the same instant draws the same flame", () => {
    expect(torchCloud(400, 3)).toEqual(torchCloud(400, 3));
    const shapes = new Set([0, 200, 400, 600, 800, 1000, 1200].map((ms) => JSON.stringify(torchCloud(ms, 3))));
    expect(shapes.size).toBeGreaterThan(1);
    expect(torchCloud(0, 3).some((pixel) => pixel.ink.startsWith("fire-"))).toBe(true);
  });
});

describe("CAVE_BACKDROP", () => {
  it("is the cave, lit dimly", () => {
    expect(CAVE_BACKDROP.id).toBe(CAVE);
    expect(CAVE_BACKDROP.ambient).toBe(CAVE_AMBIENT);
  });

  it("paints the whole band opaque", () => {
    const buffer = createBuffer(320, HEIGHT);
    CAVE_BACKDROP.paint(buffer, view(100));
    for (let y = 0; y < HEIGHT; y += 5) {
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
    // Column 0 of the second is column 10 of the first, away from any torch's flame.
    const row = 2;
    expect(bufferPixel(b, 0, row)).toEqual(bufferPixel(a, 10, row));
  });

  it("lights a torch for every one in view, and only those", () => {
    for (let offset = 0; offset < PANORAMA_WIDTH; offset += 160) {
      const lights = CAVE_BACKDROP.lights(view(offset, 500));
      for (const light of lights) {
        expect(light.x).toBeGreaterThan(-5);
        expect(light.x).toBeLessThan(325);
        expect(light.intensity).toBeGreaterThan(0);
      }
    }
    const total = Array.from({ length: 4 }, (_unused, k) => CAVE_BACKDROP.lights(view(k * 320)).length);
    expect(total.reduce((sum, n) => sum + n, 0)).toBe(TORCH_COUNT);
  });

  it("asks to be repainted when the heading or the flames move, and not otherwise", () => {
    expect(CAVE_BACKDROP.signature(view(5, 10))).toBe(CAVE_BACKDROP.signature(view(5, 20)));
    expect(CAVE_BACKDROP.signature(view(5, 10))).not.toBe(CAVE_BACKDROP.signature(view(6, 10)));
    expect(CAVE_BACKDROP.signature(view(5, 10))).not.toBe(CAVE_BACKDROP.signature(view(5, 500)));
  });
});
