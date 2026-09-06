import { describe, expect, it } from "vitest";

import { chainCloud, createChain, resetChain, stepChain, type Chain } from "./verlet";

type Force = (index: number, depth: number) => { x: number; y: number };

const CALM: Force = () => ({ x: 0, y: 0 });

function run(chain: Chain, totalMs: number, sliceMs: number, force: Force = CALM): void {
  for (let elapsed = 0; elapsed < totalMs; elapsed += sliceMs) {
    stepChain(chain, sliceMs, force);
  }
}

describe("creating a chain", () => {
  it("hangs from the anchor at the rest length", () => {
    const chain = createChain({ anchorX: 3, anchorY: -10, segments: 4, restLength: 2 });
    expect(chain.points).toHaveLength(5);
    expect(chain.points[0]).toMatchObject({ x: 3, y: -10 });
    expect(chain.points[4]?.y).toBe(-2);
  });

  it("rejects a chain with no segments or no length", () => {
    expect(() => createChain({ segments: 0 })).toThrow(/at least one segment/);
    expect(() => createChain({ restLength: 0 })).toThrow(/greater than zero/);
  });

  it("leans differently at different seeds, so a stand is not a comb", () => {
    const tipX = (seed: number): number => createChain({ seed }).points[6]?.x ?? 0;
    expect(tipX(1)).not.toBe(tipX(2));
  });
});

describe("stepping a chain", () => {
  it("never moves the anchor", () => {
    const chain = createChain({ anchorX: 5, anchorY: -12 });
    run(chain, 2000, 16, () => ({ x: 0.0002, y: 0 }));
    expect(chain.points[0]).toMatchObject({ x: 5, y: -12 });
  });

  it("holds the segments near their rest length under gravity", () => {
    const chain = createChain({ segments: 8, restLength: 3, iterations: 6 });
    run(chain, 3000, 16);
    for (let index = 0; index < chain.points.length - 1; index += 1) {
      const a = chain.points[index];
      const b = chain.points[index + 1];
      expect(Math.hypot((b?.x ?? 0) - (a?.x ?? 0), (b?.y ?? 0) - (a?.y ?? 0))).toBeCloseTo(3, 0);
    }
  });

  it("blows the tip downwind and further than the collar", () => {
    const chain = createChain({ segments: 8, restLength: 2.5 });
    run(chain, 2500, 16, (_index, depth) => ({ x: 0.00004 * (0.3 + depth), y: 0 }));
    const collar = chain.points[1]?.x ?? 0;
    const tip = chain.points[8]?.x ?? 0;
    expect(tip).toBeGreaterThan(collar);
  });

  it("keeps swinging after the force stops — the point of simulating it", () => {
    const chain = createChain({ segments: 8, restLength: 2.5, damping: 0.995 });
    run(chain, 1200, 16, () => ({ x: 0.00006, y: 0 }));
    const atGustEnd = chain.points[8]?.x ?? 0;
    run(chain, 200, 16);
    expect(chain.points[8]?.x ?? 0).not.toBeCloseTo(atGustEnd, 3);
  });

  it("lands on the same shape whatever frame rate delivered the time", () => {
    const shape = (sliceMs: number): string => {
      const chain = createChain({ seed: 7 });
      run(chain, 1600, sliceMs, () => ({ x: 0.00003, y: 0 }));
      return JSON.stringify(chainCloud(chain, "deep"));
    };
    expect(shape(16)).toBe(shape(8));
  });

  it("clamps a backgrounded tab's delta instead of teleporting the rope", () => {
    const chain = createChain();
    stepChain(chain, 40_000, () => ({ x: 0.0001, y: 0 }));
    expect(Math.abs(chain.points[6]?.x ?? 0)).toBeLessThan(40);
  });
});

describe("drawing and resetting", () => {
  it("strokes integer pixels and can cap the tip in another ink", () => {
    const chain = createChain({ segments: 3, restLength: 3 });
    const cloud = chainCloud(chain, "deep", "neon-green");
    expect(cloud.every((pixel) => Number.isInteger(pixel.x) && Number.isInteger(pixel.y))).toBe(true);
    expect(cloud[cloud.length - 1]?.ink).toBe("neon-green");
  });

  it("restores the created shape and clears the velocities", () => {
    const chain = createChain({ seed: 3 });
    const fresh = JSON.stringify(chain.points);
    run(chain, 1500, 16, () => ({ x: 0.00008, y: 0 }));
    resetChain(chain);
    expect(JSON.stringify(chain.points)).toBe(fresh);
    expect(chain.accumulatorMs).toBe(0);
  });
});
