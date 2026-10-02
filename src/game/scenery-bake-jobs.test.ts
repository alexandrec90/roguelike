import { describe, expect, it } from "vitest";

import { bakePose, quantizeLight, settleAt, WIND_LEVELS } from "./scenery-bake";
import { BakeBench, speciesSways, transferables } from "./scenery-bake-jobs";
import { findSpecies } from "./trees";

const LIGHT = quantizeLight({ x: -0.6, y: -0.8 }, 0.7);
const REST = Math.floor(WIND_LEVELS.length / 2);

describe("the bake bench", () => {
  it("makes the picture a direct bake makes", () => {
    const instance = findSpecies("oak-recursive")!.create(11);
    settleAt(instance, WIND_LEVELS[REST] ?? 0, LIGHT);
    const direct = bakePose(instance, LIGHT, WIND_LEVELS[REST] ?? 0);
    const benched = new BakeBench().run({ kind: "lean", species: "oak-recursive", seed: 11, light: LIGHT, lean: REST });
    expect(benched?.body.buffer.data).toEqual(direct.body.buffer.data);
    expect(benched?.body.originX).toBe(direct.body.originX);
  });

  it("bakes horizon scales smaller than the body, with no shadow", () => {
    const bench = new BakeBench();
    const full = bench.run({ kind: "lean", species: "sdf-crown", seed: 5, light: LIGHT, lean: REST });
    const far = bench.run({ kind: "scale", species: "sdf-crown", seed: 5, light: LIGHT, scale: 0.3 });
    expect(far?.shadow).toBeNull();
    expect(far!.body.buffer.height).toBeLessThan(full!.body.buffer.height);
  });

  it("answers null for a species the catalogue does not know", () => {
    expect(new BakeBench().run({ kind: "scale", species: "nope", seed: 1, light: LIGHT, scale: 0.5 })).toBeNull();
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
    const result = new BakeBench().run({ kind: "lean", species: "oak-recursive", seed: 2, light: LIGHT, lean: REST });
    const owned = transferables(result);
    expect(owned).toContain(result!.body.buffer.data.buffer);
    expect(owned).toHaveLength(result!.shadow === null ? 1 : 2);
    expect(transferables(null)).toEqual([]);
  });
});
