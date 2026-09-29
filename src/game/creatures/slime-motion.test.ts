import { describe, expect, it } from "vitest";

import {
  arcLift,
  createSpring,
  HOP_AIR_MS,
  HOP_TOTAL_MS,
  HOP_WINDUP_MS,
  hopBeat,
  hopHeight,
  hopSquashTarget,
  MAX_SQUASH,
  stepSpring,
} from "./slime-motion";

describe("the squash spring", () => {
  it("rests at rest", () => {
    const spring = createSpring();
    stepSpring(spring, 0, 500);
    expect(spring.value).toBe(0);
  });

  it("settles on its target", () => {
    const spring = createSpring();
    for (let frame = 0; frame < 120; frame += 1) {
      stepSpring(spring, 0.2, 16);
    }
    expect(spring.value).toBeCloseTo(0.2, 2);
  });

  it("overshoots after a kick — the wobble is the point", () => {
    const spring = createSpring();
    spring.velocity = -8;
    let lowest = 0;
    let highest = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      stepSpring(spring, 0, 16);
      lowest = Math.min(lowest, spring.value);
      highest = Math.max(highest, spring.value);
    }
    expect(lowest).toBeLessThan(-0.1);
    expect(highest).toBeGreaterThan(0.02);
  });

  it("never leaves its range, however hard it is kicked or however long the frame", () => {
    const spring = createSpring();
    spring.velocity = 500;
    stepSpring(spring, 0, 1000);
    expect(Math.abs(spring.value)).toBeLessThanOrEqual(MAX_SQUASH);
  });

  it("is deterministic for the same deltas", () => {
    const a = createSpring();
    const b = createSpring();
    a.velocity = b.velocity = 5;
    for (const delta of [16, 17, 33, 8, 16]) {
      stepSpring(a, -0.1, delta);
      stepSpring(b, -0.1, delta);
    }
    expect(a).toEqual(b);
  });
});

describe("a hop", () => {
  it("runs windup, air, land, done in order", () => {
    expect(hopBeat(0).beat).toBe("windup");
    expect(hopBeat(HOP_WINDUP_MS + 1).beat).toBe("air");
    expect(hopBeat(HOP_WINDUP_MS + HOP_AIR_MS + 1).beat).toBe("land");
    expect(hopBeat(HOP_TOTAL_MS).beat).toBe("done");
  });

  it("flies a parabola that starts and ends on the ground", () => {
    expect(arcLift(0, 8)).toBe(0);
    expect(arcLift(1, 8)).toBe(0);
    expect(arcLift(0.5, 8)).toBe(8);
    expect(arcLift(-1, 8)).toBe(0);
  });

  it("goes higher the further it goes", () => {
    expect(hopHeight(1.2)).toBeGreaterThan(hopHeight(0.6));
  });

  it("squats before take-off and stretches in the air", () => {
    expect(hopSquashTarget(HOP_WINDUP_MS * 0.9)).toBeLessThan(-0.2);
    expect(hopSquashTarget(HOP_WINDUP_MS + 5)).toBeGreaterThan(0.1);
    expect(hopSquashTarget(HOP_TOTAL_MS - 1)).toBe(0);
  });
});
