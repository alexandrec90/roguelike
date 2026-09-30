import { describe, expect, it } from "vitest";

import { ambientLevel, flicker, LIGHT_BANDS, lightFalloff, lightPool } from "./lights";
import { bufferPixel } from "./pixel-buffer";

describe("flicker", () => {
  it("wobbles within its band and repeats for a seed", () => {
    for (let t = 0; t < 5000; t += 37) {
      const level = flicker(t, 3);
      expect(level).toBeGreaterThanOrEqual(0.75);
      expect(level).toBeLessThanOrEqual(1.1);
    }
    expect(flicker(1234, 3)).toBe(flicker(1234, 3));
    expect(flicker(1234, 3)).not.toBe(flicker(1234, 4));
  });
});

describe("light falloff", () => {
  it("is brightest at the centre, dark past the rim, and banded", () => {
    expect(lightFalloff(0, 0, 20)).toBe(1);
    expect(lightFalloff(25, 0, 20)).toBe(0);
    const level = lightFalloff(7, 3, 20) * LIGHT_BANDS;
    expect(Number.isInteger(Math.round(level * 1e6) / 1e6)).toBe(true);
  });

  it("is foreshortened like the ground it lights", () => {
    // The same distance reads further away vertically.
    expect(lightFalloff(0, 12, 20)).toBeLessThanOrEqual(lightFalloff(12, 0, 20));
  });
});

describe("a baked pool", () => {
  it("is white at the centre, black at the corner, squat, and opaque", () => {
    const pool = lightPool(16);
    expect(pool.width).toBe(33);
    expect(pool.height).toBeLessThan(pool.width);
    const centre = bufferPixel(pool, 16, Math.floor(pool.height / 2));
    expect(centre).toEqual([255, 255, 255, 255]);
    expect(bufferPixel(pool, 0, 0)).toEqual([0, 0, 0, 255]);
  });

  it("reads an ambient colour's brightness", () => {
    expect(ambientLevel("#ffffff")).toBeCloseTo(1, 6);
    expect(ambientLevel("#000000")).toBe(0);
  });
});
