import { describe, expect, it } from "vitest";

import { growSkeleton, limbTips, type Limb } from "./growth";

function span(limbs: readonly Limb[]): { top: number; width: number } {
  const xs = limbs.map((limb) => limb.x);
  return {
    top: Math.min(...limbs.map((limb) => limb.y)),
    width: Math.max(...xs) - Math.min(...xs),
  };
}

describe("growing a skeleton", () => {
  it("roots at the origin and climbs into the crown", () => {
    const limbs = growSkeleton({ seed: 11 });
    expect(limbs[0]).toMatchObject({ x: 0, y: 0, parent: -1 });
    expect(span(limbs).top).toBeLessThan(-20);
  });

  it("stays inside the crown envelope it was given", () => {
    const limbs = growSkeleton({ seed: 5, crownRadiusX: 8, crownY: -20, crownRadiusY: 6 });
    expect(span(limbs).width).toBeLessThan(30);
  });

  it("gives every limb but the root a parent that precedes it", () => {
    for (const [index, limb] of growSkeleton({ seed: 3 }).entries()) {
      expect(limb.parent).toBeLessThan(index);
      expect(limb.parent).toBeGreaterThanOrEqual(index === 0 ? -1 : 0);
    }
  });

  it("tapers: the trunk is thicker than anything it feeds", () => {
    const limbs = growSkeleton({ seed: 21 });
    const root = limbs[0]?.thickness ?? 0;
    expect(root).toBeGreaterThan(1);
    expect(Math.max(...limbTips(limbs).map((tip) => tip.thickness))).toBeLessThan(root);
  });

  it("grows a different tree for a different seed, not the same one jittered", () => {
    const a = growSkeleton({ seed: 1 });
    const b = growSkeleton({ seed: 2 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("is deterministic, and returns the cached skeleton for a repeated config", () => {
    const first = growSkeleton({ seed: 77 });
    expect(growSkeleton({ seed: 77 })).toBe(first);
  });

  it("honours the limb cap", () => {
    expect(growSkeleton({ seed: 9, maxLimbs: 40 }).length).toBeLessThanOrEqual(40);
  });

  it("still produces a trunk when no attractor is ever in reach", () => {
    const limbs = growSkeleton({ seed: 4, attractors: 0, maxLimbs: 12 });
    expect(limbs.length).toBeGreaterThan(1);
    expect(limbTips(limbs)).toHaveLength(1);
  });
});

describe("tips", () => {
  it("finds the limbs nothing grew from", () => {
    const limbs = growSkeleton({ seed: 33 });
    const tips = limbTips(limbs);
    expect(tips.length).toBeGreaterThan(3);
    expect(tips.length).toBeLessThan(limbs.length);
  });
});
