import { describe, expect, it } from "vitest";

import { PLACED_SPECIES, pickSpecies, SCENERY_LATTICES, sceneryNear, speciesHeight } from "./scenery-features";
import { TALLEST_BODY } from "./scenery-slots";
import { featuresNear, terrainAt } from "./terrain";
import { findSpecies } from "./trees";

const HOME = { x: 128, y: 128 };

describe("the scenery on the planet", () => {
  it("only places species the catalogue can build", () => {
    for (const id of PLACED_SPECIES) {
      expect(findSpecies(id), id).toBeDefined();
    }
  });

  it("finds a mix of species near the start, none of them in rock", () => {
    const found = sceneryNear(HOME, 24);
    expect(found.length).toBeGreaterThan(10);
    expect(new Set(found.map((feature) => feature.species)).size).toBeGreaterThan(3);
    for (const feature of found) {
      expect(terrainAt(feature)).not.toBe("rock");
    }
  });

  it("never stacks two bodies in one planet cell", () => {
    const cells = sceneryNear(HOME, 30).map((feature) => `${Math.floor(feature.x)},${Math.floor(feature.y)}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("finds from its chunk cache what a direct sweep of every lattice finds", () => {
    const reach = 20;
    const cached = new Set(sceneryNear(HOME, reach).map((feature) => `${feature.x},${feature.y}`));
    for (const lattice of SCENERY_LATTICES) {
      for (const feature of featuresNear(HOME, reach - 1, lattice.spec)) {
        expect(cached.has(`${feature.x},${feature.y}`)).toBe(true);
      }
    }
  });

  it("sees across the planet's seam", () => {
    const seam = { x: 1, y: 128 };
    const found = sceneryNear(seam, 12);
    expect(found.some((feature) => feature.x > 240)).toBe(true);
    expect(found.some((feature) => feature.x < 16)).toBe(true);
  });

  it("is the same wood every time", () => {
    expect(sceneryNear(HOME, 12)).toEqual(sceneryNear(HOME, 12));
  });

  it("picks species by weight, deterministically", () => {
    const mix = [
      ["a", 1],
      ["b", 3],
    ] as const;
    const picks = Array.from({ length: 400 }, (_unused, seed) => pickSpecies(mix, seed));
    const bs = picks.filter((pick) => pick === "b").length;
    expect(bs).toBeGreaterThan(250);
    expect(bs).toBeLessThan(350);
    expect(pickSpecies(mix, 17)).toBe(pickSpecies(mix, 17));
  });
});

describe("speciesHeight", () => {
  it("knows every placed species, a tree taller than a bush, none taller than the tallest body", () => {
    for (const species of PLACED_SPECIES) {
      expect(speciesHeight(species)).toBeGreaterThan(0);
      expect(speciesHeight(species)).toBeLessThanOrEqual(TALLEST_BODY);
    }
    expect(speciesHeight("sdf-crown")).toBeGreaterThan(speciesHeight("bush"));
    expect(speciesHeight("mushroom-ring")).toBeLessThan(speciesHeight("boulder"));
    expect(speciesHeight("no-such-species")).toBe(TALLEST_BODY);
  });
});
