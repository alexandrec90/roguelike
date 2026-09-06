import { describe, expect, it } from "vitest";

import { drawnAt, probeGrid, stepDrift, truthAt, worstDrift } from "./map-drift";
import { DEFAULT_STRAFE_RADIUS, type PlanetPose } from "./planet";
import { TILE_WIDTH } from "./projection";

const HERE: PlanetPose = { x: 128, y: 128, turn: 0 };
const RADIUS = 19;

describe("truthAt", () => {
  it("is the identity at the start of a step", () => {
    const local = { x: 3, y: 7 };
    const at = truthAt(HERE, local, { forward: 0, strafe: 1 }, RADIUS, 0);
    expect(at.x).toBeCloseTo(local.x, 6);
    expect(at.y).toBeCloseTo(local.y, 6);
  });

  it("sweeps a far point further sideways than a near one", () => {
    const gait = { forward: 0, strafe: 1 };
    const near = truthAt(HERE, { x: 0, y: 2 }, gait, RADIUS, 1);
    const far = truthAt(HERE, { x: 0, y: 12 }, gait, RADIUS, 1);
    // d * (1 + y / radius): 1.105 against 1.632.
    expect(Math.abs(near.x)).toBeCloseTo(1 + 2 / RADIUS, 2);
    expect(Math.abs(far.x)).toBeCloseTo(1 + 12 / RADIUS, 2);
    expect(Math.abs(far.x)).toBeGreaterThan(Math.abs(near.x));
  });
});

describe("stepDrift", () => {
  it("reports no drift for a forward step, at any progress", () => {
    const gait = { forward: 1, strafe: 0 };
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const samples = stepDrift(HERE, gait, RADIUS, probeGrid(-10, 10, -4, 12), progress);
      expect(worstDrift(samples)).toBeLessThan(1e-9);
    }
  });

  it("reports no drift at the very start of a strafe", () => {
    const samples = stepDrift(HERE, { forward: 0, strafe: 1 }, RADIUS, probeGrid(-10, 10, -4, 12), 0);
    expect(worstDrift(samples)).toBeLessThan(1e-9);
  });

  it("reports a snap of about ten pixels at the end of one sideways step", () => {
    const samples = stepDrift(HERE, { forward: 0, strafe: 1 }, RADIUS, [{ x: 0, y: 12 }]);
    const sample = samples[0];
    expect(sample).toBeDefined();
    // A point 12 tiles ahead sweeps 12/19 of a tile further than the drawing moves it.
    expect(sample?.dxPx ?? 0).toBeCloseTo((-12 / RADIUS) * TILE_WIDTH, 0);
  });

  it("grows monotonically through the step rather than only at its end", () => {
    const probes = [{ x: 0, y: 12 }];
    const gait = { forward: 0, strafe: 1 };
    const at = (p: number) => worstDrift(stepDrift(HERE, gait, RADIUS, probes, p));
    expect(at(0.25)).toBeLessThan(at(0.5));
    expect(at(0.5)).toBeLessThan(at(1));
  });

  it("moves points on opposite sides in opposite depth directions", () => {
    const gait = { forward: 0, strafe: 1 };
    const [right, left] = stepDrift(HERE, gait, RADIUS, [
      { x: 8, y: 12 },
      { x: -8, y: 12 },
    ]);
    expect(right?.dyPx ?? 0).toBeGreaterThan(0);
    expect(left?.dyPx ?? 0).toBeLessThan(0);
  });

  it("shrinks as the strafe radius grows", () => {
    const probes = [{ x: 0, y: 12 }];
    const gait = { forward: 0, strafe: 1 };
    const tight = worstDrift(stepDrift(HERE, gait, 19, probes));
    const wide = worstDrift(stepDrift(HERE, gait, 200, probes));
    expect(wide).toBeLessThan(tight / 5);
  });
});

describe("the shipped strafe radius", () => {
  // The visible local box at the 320x180 target, from `visibleLocal`.
  const VISIBLE = probeGrid(-11, 12, -5, 12, 1);
  const gait = { forward: 0, strafe: 1 };

  it("moves nothing on screen a whole pixel up or down", () => {
    // The complaint this radius was chosen to answer: strafing must not make
    // objects visibly rise and fall. Depth motion is `d * x / radius` tiles, so
    // it is worst at the edges of the field, which `VISIBLE` includes.
    const samples = stepDrift(HERE, gait, DEFAULT_STRAFE_RADIUS, VISIBLE);
    const worstDepth = samples.reduce((w, s) => Math.max(w, Math.abs(s.dyPx)), 0);
    expect(worstDepth).toBeLessThan(0.5);
  });

  it("keeps the whole snap sub-pixel, not just the depth half of it", () => {
    expect(worstDrift(stepDrift(HERE, gait, DEFAULT_STRAFE_RADIUS, VISIBLE))).toBeLessThan(0.5);
  });

  it("would fail at the radius that made the world visibly jump", () => {
    // Guards the guard: a threshold no setting can breach is not a test. 19 was
    // the old default, and it moved things seven pixels up and down per step.
    const samples = stepDrift(HERE, gait, 19, VISIBLE);
    expect(samples.reduce((w, s) => Math.max(w, Math.abs(s.dyPx)), 0)).toBeGreaterThan(5);
  });
});

describe("drawnAt", () => {
  it("shifts every point by the same offset, whatever its depth", () => {
    const gait = { forward: 0, strafe: 1 };
    const near = drawnAt({ x: 0, y: 2 }, gait, 1);
    const far = drawnAt({ x: 0, y: 12 }, gait, 1);
    expect(near.x).toBe(-1);
    expect(far.x).toBe(-1);
  });
});

describe("probeGrid", () => {
  it("covers the bounds at the requested stride", () => {
    const probes = probeGrid(-10, 10, -5, 10, 5);
    expect(probes.length).toBeGreaterThan(0);
    for (const probe of probes) {
      expect(probe.x).toBeGreaterThanOrEqual(-10);
      expect(probe.x).toBeLessThanOrEqual(10);
      expect(probe.y).toBeGreaterThanOrEqual(-5);
      expect(probe.y).toBeLessThanOrEqual(10);
    }
  });
});
