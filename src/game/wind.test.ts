import { describe, expect, it } from "vitest";

import { createSway, gustAt, resetSway, stepSway, windAt, type Sway } from "./wind";

function drive(sway: Sway, totalMs: number, force: number, sliceMs = 16): number {
  let angle = 0;
  for (let elapsed = 0; elapsed < totalMs; elapsed += sliceMs) {
    angle = stepSway(sway, sliceMs, force);
  }
  return angle;
}

describe("the wind field", () => {
  it("is deterministic and bounded by its strength", () => {
    for (let time = 0; time < 20_000; time += 313) {
      const sample = windAt(time, 12, -8, { strength: 1 });
      expect(Math.abs(sample)).toBeLessThan(2.2);
      expect(windAt(time, 12, -8, { strength: 1 })).toBe(sample);
    }
  });

  it("scales linearly with strength, so a calm day is the same weather turned down", () => {
    expect(windAt(4200, 5, 0, { strength: 2 })).toBeCloseTo(windAt(4200, 5, 0, { strength: 1 }) * 2, 10);
    expect(windAt(4200, 5, 0, { strength: 0 })).toBe(0);
  });

  it("travels: a point downwind feels the same wave at a later moment", () => {
    const here = windAt(3000, 0, 0, { gustiness: 0 });
    const there = windAt(3000, 46, 0, { gustiness: 0 });
    expect(there).not.toBeCloseTo(here, 3);
  });

  it("gusts and lulls when gustiness is high, and steadies when it is zero", () => {
    const samples = (gustiness: number): number[] =>
      Array.from({ length: 240 }, (_, index) => gustAt(index * 120, { gustiness }));
    const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);
    expect(spread(samples(1))).toBeGreaterThan(spread(samples(0)));
    expect(spread(samples(0))).toBeCloseTo(0, 6);
  });

  it("keeps the gust envelope non-negative", () => {
    for (let time = 0; time < 40_000; time += 421) {
      expect(gustAt(time, { gustiness: 0.8 })).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("the sway spring", () => {
  it("rejects a spring that cannot exist", () => {
    expect(() => createSway({ frequency: 0 })).toThrow(/greater than zero/);
    expect(() => createSway({ damping: 2 })).toThrow(/between 0 and 1/);
  });

  it("settles on the driving force rather than tracking it instantly", () => {
    const sway = createSway({ frequency: 0.6, damping: 0.5, response: 1 });
    const early = stepSway(sway, 16, 1);
    expect(early).toBeLessThan(0.2);
    expect(drive(sway, 6000, 1)).toBeCloseTo(1, 1);
  });

  it("overshoots when it is lightly damped and does not when it is heavily damped", () => {
    const peak = (damping: number): number => {
      const sway = createSway({ frequency: 0.8, damping, response: 1 });
      let highest = 0;
      for (let elapsed = 0; elapsed < 2000; elapsed += 16) {
        highest = Math.max(highest, stepSway(sway, 16, 1));
      }
      return highest;
    };
    expect(peak(0.05)).toBeGreaterThan(1.2);
    expect(peak(0.95)).toBeLessThanOrEqual(1.02);
  });

  it("keeps ringing after the wind drops — the term a keyframe cannot fake", () => {
    const sway = createSway({ frequency: 0.9, damping: 0.08, response: 1 });
    drive(sway, 1500, 1);
    const atDrop = stepSway(sway, 16, 0);
    const later = drive(sway, 300, 0);
    expect(Math.abs(later - atDrop)).toBeGreaterThan(0.02);
  });

  it("lands on the same angle whatever frame rate delivered the time", () => {
    const angle = (sliceMs: number): number => drive(createSway(), 3200, 0.8, sliceMs);
    expect(angle(16)).toBeCloseTo(angle(8), 6);
  });

  it("clamps a backgrounded tab's delta", () => {
    const sway = createSway();
    stepSway(sway, 60_000, 1);
    expect(Math.abs(sway.angle)).toBeLessThan(3);
  });

  it("resets to rest", () => {
    const sway = createSway();
    drive(sway, 1000, 1);
    resetSway(sway);
    expect(sway).toMatchObject({ angle: 0, velocity: 0, accumulatorMs: 0 });
  });
});
