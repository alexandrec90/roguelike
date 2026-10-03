import { describe, expect, it } from "vitest";

import { bakePose, bakeScaled, quantizeLight, settleAt, WIND_LEVELS } from "./scenery-bake";
import { BakeBench, speciesSways, transferables, type BakeResult } from "./scenery-bake-jobs";
import { findSpecies } from "./trees";

const LIGHT = quantizeLight({ x: -0.6, y: -0.8 }, 0.7);
const REST = Math.floor(WIND_LEVELS.length / 2);

function lean(result: BakeResult | null): Extract<BakeResult, { kind: "lean" }> {
  if (result?.kind !== "lean") {
    throw new Error("expected a lean");
  }
  return result;
}

function ladder(result: BakeResult | null): Extract<BakeResult, { kind: "ladder" }> {
  if (result?.kind !== "ladder") {
    throw new Error("expected a ladder");
  }
  return result;
}

describe("the bake bench", () => {
  it("makes the picture a direct bake makes", () => {
    const instance = findSpecies("oak-recursive")!.create(11);
    settleAt(instance, WIND_LEVELS[REST] ?? 0, LIGHT);
    const direct = bakePose(instance, LIGHT, WIND_LEVELS[REST] ?? 0);
    const benched = lean(new BakeBench().run({ kind: "lean", species: "oak-recursive", seed: 11, light: LIGHT, lean: REST }));
    expect(benched.body.buffer.data).toEqual(direct.body.buffer.data);
    expect(benched.body.originX).toBe(direct.body.originX);
  });

  it("bakes a ladder of horizon scales, one frame per scale, each smaller than the body", () => {
    const bench = new BakeBench();
    const full = lean(bench.run({ kind: "lean", species: "sdf-crown", seed: 5, light: LIGHT, lean: REST }));
    const far = ladder(bench.run({ kind: "ladder", species: "sdf-crown", seed: 5, light: LIGHT, scales: [0.1, 0.3, 0.6] }));
    expect(far.frames).toHaveLength(3);
    const heights = far.frames.map((frame) => frame.buffer.height);
    expect(heights[0]).toBeLessThan(heights[1] ?? 0);
    expect(heights[1]).toBeLessThan(heights[2] ?? 0);
    expect(heights[2]).toBeLessThan(full.body.buffer.height);
  });

  it("makes each rung of a ladder the picture a single-scale bake makes", () => {
    for (const species of ["sdf-crown", "oak-recursive"]) {
      const instance = findSpecies(species)!.create(7);
      const single = bakeScaled(instance, LIGHT, 0.45);
      const rung = ladder(new BakeBench().run({ kind: "ladder", species, seed: 7, light: LIGHT, scales: [0.2, 0.45] })).frames[1];
      expect(rung?.buffer.data).toEqual(single.buffer.data);
      expect(rung?.originY).toBe(single.originY);
    }
  });

  it("answers null for a species the catalogue does not know", () => {
    expect(new BakeBench().run({ kind: "ladder", species: "nope", seed: 1, light: LIGHT, scales: [0.5] })).toBeNull();
  });
});

describe("speciesSways", () => {
  it("is true for a tree with springs and false for a stone", () => {
    expect(speciesSways("oak-recursive", 1)).toBe(true);
    expect(speciesSways("boulder", 1)).toBe(false);
    expect(speciesSways("nope", 1)).toBe(false);
  });
});

describe("transferables", () => {
  it("lists the body's buffer and the shadow's when there is one", () => {
    const result = lean(new BakeBench().run({ kind: "lean", species: "oak-recursive", seed: 2, light: LIGHT, lean: REST }));
    const owned = transferables(result);
    expect(owned).toContain(result.body.buffer.data.buffer);
    expect(owned).toHaveLength(result.shadow === null ? 1 : 2);
    expect(transferables(null)).toEqual([]);
  });

  it("lists every frame of a ladder", () => {
    const result = ladder(new BakeBench().run({ kind: "ladder", species: "boulder", seed: 2, light: LIGHT, scales: [0.2, 0.4] }));
    expect(transferables(result)).toEqual(result.frames.map((frame) => frame.buffer.data.buffer));
  });
});
