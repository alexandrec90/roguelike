import { describe, expect, it } from "vitest";

import { cloudBounds } from "../ink";
import { banded, createFlame, FLAME_RAMP, flameCloud, flameStrength, humpFuel, settleFlame, stepFlame } from "./flame";

function centroidX(cloud: ReturnType<typeof flameCloud>): number {
  return cloud.reduce((sum, pixel) => sum + pixel.x, 0) / Math.max(cloud.length, 1);
}

describe("creating a flame", () => {
  it("rejects a grid too small or not whole, and a tick that is not positive", () => {
    expect(() => createFlame({ width: 2, height: 10, seed: 1 })).toThrow(/at least 3x3/);
    expect(() => createFlame({ width: 5.5, height: 10, seed: 1 })).toThrow(/integer grid/);
    expect(() => createFlame({ width: 8, height: 10, seed: 1, tickMs: 0 })).toThrow(/tick/);
  });

  it("starts cold: no pixels before it has been stepped", () => {
    expect(flameCloud(createFlame({ width: 12, height: 20, seed: 1 }))).toEqual([]);
  });
});

describe("burning", () => {
  it("is deterministic for a seed and a sequence of deltas", () => {
    const a = createFlame({ width: 12, height: 20, seed: 42 });
    const b = createFlame({ width: 12, height: 20, seed: 42 });
    for (const delta of [16, 33, 7, 50, 16]) {
      stepFlame(a, delta);
      stepFlame(b, delta);
    }
    expect(flameCloud(a)).toEqual(flameCloud(b));
    expect(flameCloud(a).length).toBeGreaterThan(0);
  });

  it("differs between seeds", () => {
    const a = createFlame({ width: 12, height: 20, seed: 1 });
    const b = createFlame({ width: 12, height: 20, seed: 2 });
    settleFlame(a, 900);
    settleFlame(b, 900);
    expect(flameCloud(a)).not.toEqual(flameCloud(b));
  });

  it("stays inside its grid, foot-anchored on the middle of its base", () => {
    const flame = createFlame({ width: 12, height: 20, seed: 3 });
    settleFlame(flame, 1500);
    const bounds = cloudBounds(flameCloud(flame));
    expect(bounds).not.toBeNull();
    expect(bounds?.left).toBeGreaterThanOrEqual(-6);
    expect(bounds?.right).toBeLessThanOrEqual(5);
    expect(bounds?.top).toBeGreaterThanOrEqual(-19);
    expect(bounds?.bottom).toBe(0);
  });

  it("inks only from the flame ramp, with the hot core low and the dark tips high", () => {
    const flame = createFlame({ width: 12, height: 20, seed: 5 });
    settleFlame(flame, 1500);
    const cloud = flameCloud(flame);
    expect(cloud.every((pixel) => FLAME_RAMP.includes(pixel.ink))).toBe(true);
    const core = cloud.filter((pixel) => pixel.ink === "fire-6" || pixel.ink === "fire-5");
    const tips = cloud.filter((pixel) => pixel.ink === FLAME_RAMP[0]);
    expect(core.length).toBeGreaterThan(0);
    const mean = (pixels: typeof cloud): number => pixels.reduce((sum, p) => sum + p.y, 0) / pixels.length;
    expect(mean(core)).toBeGreaterThan(mean(tips));
  });

  it("leans with the wind", () => {
    const still = createFlame({ width: 12, height: 20, seed: 8 });
    const windy = createFlame({ width: 12, height: 20, seed: 8 });
    let stillSum = 0;
    let windySum = 0;
    for (let index = 0; index < 40; index += 1) {
      stepFlame(still, 30);
      stepFlame(windy, 30, { wind: 1 });
      stillSum += centroidX(flameCloud(still));
      windySum += centroidX(flameCloud(windy));
    }
    expect(windySum).toBeGreaterThan(stillSum + 20);
  });

  it("goes out without fuel", () => {
    const flame = createFlame({ width: 12, height: 20, seed: 9 });
    settleFlame(flame, 900);
    expect(flameStrength(flame)).toBeGreaterThan(0.05);
    settleFlame(flame, 1500, { intensity: 0 });
    expect(flameStrength(flame)).toBe(0);
  });

  it("clamps a long delta to a few ticks rather than fast-forwarding", () => {
    const flame = createFlame({ width: 12, height: 20, seed: 9, tickMs: 30 });
    stepFlame(flame, 60_000);
    expect(flame.tick).toBeLessThanOrEqual(6);
    expect(flame.carryMs).toBeLessThan(30);
  });
});

describe("the fuel and the ramp", () => {
  it("humps in the middle and falls away at the ends", () => {
    expect(humpFuel(6, 12)).toBeGreaterThan(humpFuel(0, 12));
    expect(humpFuel(6, 12)).toBeLessThanOrEqual(1);
    expect(humpFuel(0, 12)).toBeGreaterThanOrEqual(0);
  });

  it("bands a level toward step centres, keeping the ends and the order", () => {
    expect(banded(0, 6)).toBe(0);
    expect(banded(1, 6)).toBe(1);
    let last = -1;
    for (let level = 0; level <= 1; level += 0.01) {
      const value = banded(level, 6);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
    expect(banded(0.23, 1)).toBe(0.23);
  });
});
