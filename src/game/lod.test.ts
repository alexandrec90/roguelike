import { describe, expect, it } from "vitest";

import {
  cachedPose,
  createPoseCache,
  DETAIL_TIERS,
  detailFor,
  detailInRoll,
  poseCacheHitRate,
  quantize,
  resetPoseCache,
} from "./lod";

describe("choosing a detail tier", () => {
  it("gives the nearest bodies everything", () => {
    expect(detailFor(0).tier).toBe("near");
    expect(detailFor(4).tier).toBe("near");
    expect(detailFor(0).flat).toBe(false);
  });

  it("steps down through mid to far, and culls past the horizon", () => {
    expect(detailFor(6).tier).toBe("mid");
    expect(detailFor(20).tier).toBe("far");
    expect(detailFor(500).tier).toBe("culled");
  });

  it("treats a body straddling the near edge as near, not as an error", () => {
    expect(detailFor(-3).tier).toBe("near");
  });

  it("honours thresholds a caller tunes", () => {
    expect(detailFor(3, { nearRows: 1, midRows: 2 }).tier).toBe("far");
    expect(detailFor(80, { cullRows: 10 }).tier).toBe("culled");
  });

  it("never spends more on a distant body than on a near one", () => {
    const order = ["near", "mid", "far", "culled"] as const;
    for (let index = 1; index < order.length; index += 1) {
      const nearer = DETAIL_TIERS[order[index - 1]!];
      const further = DETAIL_TIERS[order[index]!];
      expect(further.warpOctaves).toBeLessThanOrEqual(nearer.warpOctaves);
      expect(further.normalEpsilon).toBeGreaterThanOrEqual(nearer.normalEpsilon);
      expect(further.poseQuantum).toBeGreaterThanOrEqual(nearer.poseQuantum);
      expect(further.particleShare).toBeLessThanOrEqual(nearer.particleShare);
    }
  });

  it("drops the normal only once the body is far away", () => {
    // The normal is four fifths of the render and buys the rim highlight, so
    // giving it up early is exactly the pop this scheme exists to prevent.
    expect(DETAIL_TIERS.near.flat).toBe(false);
    expect(DETAIL_TIERS.mid.flat).toBe(false);
    expect(DETAIL_TIERS.far.flat).toBe(true);
  });

  it("treats the horizon roll as far, whatever row the body claims", () => {
    expect(detailInRoll().tier).toBe("far");
  });
});

describe("quantising a pose", () => {
  it("snaps to the quantum, and passes the value through at zero", () => {
    expect(quantize(1.31, 0.25)).toBeCloseTo(1.25, 6);
    expect(quantize(1.31, 0)).toBe(1.31);
    expect(quantize(-1.4, 1)).toBe(-1);
  });

  it("gives equal quantised values for poses inside one quantum", () => {
    expect(quantize(3.1, 2)).toBe(quantize(3.8, 2));
  });
});

describe("the pose cache", () => {
  it("builds once and returns the same object for a repeated key", () => {
    const cache = createPoseCache<string[]>();
    let builds = 0;
    const build = (): string[] => {
      builds += 1;
      return ["x"];
    };
    const first = cachedPose(cache, "a", build);
    expect(cachedPose(cache, "a", build)).toBe(first);
    expect(builds).toBe(1);
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(1);
  });

  it("rejects a capacity that is not a positive integer", () => {
    expect(() => createPoseCache(0)).toThrow(/positive integer/);
    expect(() => createPoseCache(1.5)).toThrow(/positive integer/);
  });

  it("never grows past its capacity", () => {
    const cache = createPoseCache<number>(4);
    for (let index = 0; index < 40; index += 1) {
      cachedPose(cache, `pose-${index}`, () => index);
    }
    expect(cache.entries.size).toBe(4);
  });

  it("evicts oldest first, keeping the poses the wind is still near", () => {
    const cache = createPoseCache<number>(2);
    cachedPose(cache, "a", () => 1);
    cachedPose(cache, "b", () => 2);
    cachedPose(cache, "c", () => 3);
    expect(cache.entries.has("a")).toBe(false);
    expect(cache.entries.has("c")).toBe(true);
  });

  it("reports a hit rate, and zero before anything is asked for", () => {
    const cache = createPoseCache<number>();
    expect(poseCacheHitRate(cache)).toBe(0);
    cachedPose(cache, "a", () => 1);
    cachedPose(cache, "a", () => 1);
    cachedPose(cache, "a", () => 1);
    expect(poseCacheHitRate(cache)).toBeCloseTo(2 / 3, 6);
  });

  it("resets", () => {
    const cache = createPoseCache<number>();
    cachedPose(cache, "a", () => 1);
    resetPoseCache(cache);
    expect(cache.entries.size).toBe(0);
    expect(cache.hits + cache.misses).toBe(0);
  });

  it("earns its keep: a coarse quantum turns a sway into a handful of poses", () => {
    // A body swaying through a continuum of leans re-renders once per distinct
    // quantised pose and hits the cache for every frame in between. This is the
    // whole saving, and it costs nothing visible because the output was snapped
    // to whole pixels anyway.
    const cache = createPoseCache<number>(32);
    let builds = 0;
    for (let frame = 0; frame < 240; frame += 1) {
      const lean = Math.sin(frame / 38) * 3;
      cachedPose(cache, String(quantize(lean, 2)), () => (builds += 1));
    }
    expect(builds).toBeLessThan(12);
    expect(poseCacheHitRate(cache)).toBeGreaterThan(0.9);
  });
});
