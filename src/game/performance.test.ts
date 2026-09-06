/**
 * The performance budget: what a second of scenery is allowed to cost.
 *
 * These are ratchets, not benchmarks. A benchmark measures the machine it runs
 * on, which in CI is whatever the runner felt like allocating, so a wall-clock
 * assertion tight enough to catch a real regression also fails at random. So
 * almost everything here counts **work** — field evaluations, renders avoided
 * by the pose cache, pixels emitted — which is a property of the code and
 * identical on every machine.
 *
 * The unit is **evaluations per second**, not per render, and that turned out
 * to matter more than expected. Measured on the chestnut canopy:
 *
 * | tier | evals per render | renders per second | evals per second |
 * | ---- | ---------------- | ------------------ | ---------------- |
 * | near | 4246             | 15                 | 63,690           |
 * | mid  | 4246             | 4                  | 16,984           |
 * | far  | 2070             | 3                  | 6,210            |
 *
 * Read the middle column: `mid` costs exactly what `near` costs *per render*.
 * All of its saving is temporal — a coarser pose quantum, so it re-renders four
 * times a second instead of fifteen. Only `far` gets cheaper per render, by
 * dropping the surface normal. If a future change makes the per-render cost the
 * only thing it optimises, these numbers will say so.
 *
 * There is exactly one wall-clock test, bounded loosely enough that only a
 * catastrophe trips it. It is here because a work count cannot notice an
 * accidental O(n²), and that is the failure worth catching in CI.
 */

import { describe, expect, it } from "vitest";

import { cachedPose, createPoseCache, DETAIL_TIERS, poseCacheHitRate, quantize } from "./lod";
import { lobeRing, volumeCloud, volumeCost, type VolumeSpec } from "./procgen/volume";
import { DEFAULT_SCENERY_ENV, type SceneryEnv } from "./scenery";
import { INK_RAMPS } from "./shading";
import { findSpecies, SCENERY_SPECIES } from "./trees";

type Tier = keyof typeof DETAIL_TIERS;

const CANOPY: VolumeSpec = {
  lobes: lobeRing(5, { x: 0, y: -29, radiusX: 9, radiusY: 6 }, { min: 6.5, max: 10 }, 0x7e31),
  weld: 2.6,
  warp: { amplitudeX: 5.4, amplitudeY: 4.2, scale: 5, seed: 0x7e31, drift: 0, octaves: 2 },
};

function litAt(tier: Tier) {
  const detail = DETAIL_TIERS[tier];
  return {
    ramp: INK_RAMPS.canopy,
    light: { x: -0.6, y: -0.8 },
    dither: detail.dither,
    normalEpsilon: detail.normalEpsilon,
    flat: detail.flat,
  };
}

/** Field evaluations for one render of the chestnut canopy at a tier. */
function perRender(tier: Tier): number {
  const meter = { evaluations: 0 };
  volumeCloud(CANOPY, { ...litAt(tier), meter });
  return meter.evaluations;
}

/**
 * How many distinct renders a second of swaying actually demands at a tier.
 *
 * The body is asked for its cloud sixty times; the pose cache turns that into
 * one render per distinct quantised pose. This is the number the detail tiers
 * mostly move, so it belongs in the budget rather than in a comment.
 */
function rendersPerSecond(tier: Tier): number {
  const quantum = DETAIL_TIERS[tier].poseQuantum;
  const poses = new Set<string>();
  for (let frame = 0; frame < 60; frame += 1) {
    poses.add(String(quantize(Math.sin(frame / 45) * 3.5, quantum)));
  }
  return poses.size;
}

function perSecond(tier: Tier): number {
  return perRender(tier) * rendersPerSecond(tier);
}

describe("one chestnut canopy, per render", () => {
  it("fits the per-body budget at full detail", () => {
    // A 320x180 frame is 57,600 pixels. One near body is allowed a tenth of
    // that in field evaluations; raise this only with a reason.
    expect(perRender("near")).toBeLessThan(6000);
  });

  it("costs meaningfully less per render once the normal is dropped", () => {
    expect(perRender("far")).toBeLessThan(perRender("near") * 0.6);
  });

  it("never exceeds the cost the model predicts, at any tier", () => {
    for (const tier of ["near", "mid", "far"] as const) {
      expect(perRender(tier)).toBeLessThanOrEqual(volumeCost(CANOPY, litAt(tier)));
    }
  });

  it("spends most of a render on the box scan, not on the normals", () => {
    // Worth pinning: the intuition is that per-pixel normals dominate, and they
    // do not. Four fifths of the pixels in the bounding box are outside the
    // body and cost one evaluation each just to be rejected. Shrinking the box
    // is therefore a better optimisation than cheapening the light, and the
    // next person to look for speed should start there.
    const scanOnly = perRender("far");
    expect(scanOnly).toBeGreaterThan(perRender("near") * 0.35);
  });
});

describe("one chestnut canopy, per second", () => {
  it("stays inside the per-body second budget at full detail", () => {
    expect(perSecond("near")).toBeLessThan(80_000);
  });

  it("costs three times less at mid, entirely by re-rendering less often", () => {
    expect(perSecond("mid") * 3).toBeLessThan(perSecond("near"));
    expect(perRender("mid")).toBe(perRender("near"));
  });

  it("costs eight times less at far", () => {
    expect(perSecond("far") * 8).toBeLessThan(perSecond("near"));
  });

  it("gets cheaper monotonically as the body recedes", () => {
    expect(perSecond("mid")).toBeLessThan(perSecond("near"));
    expect(perSecond("far")).toBeLessThan(perSecond("mid"));
  });
});

describe("a field of bodies", () => {
  /** A plausible frame: a few bodies close, more in the middle, a back row. */
  const ROWS: readonly Tier[] = [
    "near",
    "near",
    "near",
    "mid",
    "mid",
    "mid",
    "mid",
    "far",
    "far",
    "far",
    "far",
    "far",
  ];

  it("keeps twelve bodies inside the frame budget", () => {
    const total = ROWS.reduce((sum, tier) => sum + perSecond(tier), 0);
    expect(total).toBeLessThan(350_000);
  });

  it("would blow that budget twice over without the detail tiers", () => {
    // The assertion that gives the one above its meaning: the budget is met
    // because of LOD, not because the bodies happen to be cheap.
    expect(perSecond("near") * ROWS.length).toBeGreaterThan(700_000);
  });
});

describe("the pose cache", () => {
  it("turns a far body's sixty frames a second into a handful of renders", () => {
    const cache = createPoseCache<number>(24);
    let renders = 0;
    for (let frame = 0; frame < 300; frame += 1) {
      const lean = Math.sin(frame / 45) * 3.5;
      cachedPose(cache, `${quantize(lean, DETAIL_TIERS.far.poseQuantum)}`, () => (renders += 1));
    }
    expect(renders).toBeLessThan(15);
    expect(poseCacheHitRate(cache)).toBeGreaterThan(0.94);
  });

  it("still re-renders often enough at near detail to look smooth", () => {
    const cache = createPoseCache<number>(64);
    let renders = 0;
    for (let frame = 0; frame < 300; frame += 1) {
      const lean = Math.sin(frame / 45) * 3.5;
      cachedPose(cache, `${quantize(lean, DETAIL_TIERS.near.poseQuantum)}`, () => (renders += 1));
    }
    expect(renders).toBeGreaterThan(15);
  });
});

describe("every species", () => {
  it("emits a bounded number of pixels, so no body can flood a 320x180 frame", () => {
    for (const species of SCENERY_SPECIES) {
      const instance = species.create(0x31);
      for (let elapsed = 0; elapsed < 2000; elapsed += 16) {
        instance.step?.(16, { ...DEFAULT_SCENERY_ENV, elapsedMs: elapsed });
      }
      const cloud = instance.cloud({ ...DEFAULT_SCENERY_ENV, elapsedMs: 2000 });
      const { width, height } = species.footprint;
      expect(cloud.length, `${species.id} overdraws its own footprint`).toBeLessThan(width * height);
    }
  });
});

describe("wall clock", () => {
  /**
   * The one timed test, and the only one allowed to be. Its bound is loose
   * enough to survive a slow shared runner and tight enough that an accidental
   * quadratic — the failure a work count cannot see — still trips it.
   */
  it("renders sixty frames of the chestnut well inside a second", () => {
    const species = findSpecies("sdf-crown");
    expect(species).toBeDefined();
    const instance = species!.create(0x7e31);
    const env = (elapsedMs: number): SceneryEnv => ({ ...DEFAULT_SCENERY_ENV, elapsedMs });

    const started = performance.now();
    for (let frame = 0; frame < 60; frame += 1) {
      const elapsed = frame * 16;
      instance.step?.(16, env(elapsed));
      instance.cloud(env(elapsed));
    }
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
