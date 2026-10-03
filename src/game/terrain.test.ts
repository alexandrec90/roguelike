import { describe, expect, it } from "vitest";

import { blockedByLand } from "./landforms";
import { PLANET_TILES, wrapTile } from "./planet";
import {
  cachedFeaturesNear,
  featuresNear,
  puddlesNear,
  terrainAt,
  treesNear,
  type FeatureSpec,
  type Terrain,
} from "./terrain";

/** Every terrain in a wide sweep of the planet, with how often it turned up. */
function census(step: number): Record<Terrain, number> {
  const counts: Record<Terrain, number> = { grass: 0, dirt: 0 };
  for (let y = 0; y < PLANET_TILES; y += step) {
    for (let x = 0; x < PLANET_TILES; x += step) {
      counts[terrainAt({ x, y })] += 1;
    }
  }
  return counts;
}

describe("terrainAt", () => {
  it("is a function of position and nothing else", () => {
    expect(terrainAt({ x: 40, y: 90 })).toBe(terrainAt({ x: 40, y: 90 }));
  });

  it("wraps seamlessly, so the planet has no join", () => {
    // The whole point of a round world: the sample a lap away is the *same*
    // sample, not a similar one. A lattice that did not fold would put a seam
    // in the paths at one bearing that only a walk of 256 tiles would ever find.
    for (let x = 0; x < PLANET_TILES; x += 7) {
      for (const y of [0, 17.5, 199]) {
        expect(terrainAt({ x: x + PLANET_TILES, y })).toBe(terrainAt({ x, y }));
        expect(terrainAt({ x, y: y - PLANET_TILES })).toBe(terrainAt({ x, y }));
      }
    }
  });

  it("gives a flat planet of grass with paths across it - anything standing is a landform", () => {
    const counts = census(2);
    const total = counts.grass + counts.dirt;

    expect(counts.grass / total).toBeGreaterThan(0.5);
    expect(counts.dirt / total).toBeGreaterThan(0.005);
    expect(Object.keys(counts).sort()).toEqual(["dirt", "grass"]);
  });
});

describe("features", () => {
  it("are stable: the same planet point yields the same feature", () => {
    const first = treesNear({ x: 128, y: 128 }, 20);
    const second = treesNear({ x: 129, y: 128 }, 20);
    const shared = first.filter((tree) =>
      second.some((other) => other.x === tree.x && other.y === tree.y),
    );

    expect(shared.length).toBeGreaterThan(0);
    for (const tree of shared) {
      const twin = second.find((other) => other.x === tree.x && other.y === tree.y);
      expect(twin?.seed).toBe(tree.seed);
    }
  });

  it("all land inside the reach they were asked for", () => {
    const centre = { x: 40, y: 200 };
    for (const feature of puddlesNear(centre, 12)) {
      const dx = Math.abs(wrapTile(feature.x - centre.x + PLANET_TILES / 2) - PLANET_TILES / 2);
      const dy = Math.abs(wrapTile(feature.y - centre.y + PLANET_TILES / 2) - PLANET_TILES / 2);
      // A cell of margin either side is deliberate: the sweep may overshoot,
      // it may never miss one, or a puddle blinks in as the hero walks up to it.
      expect(Math.max(dx, dy)).toBeLessThanOrEqual(14);
    }
  });

  it("put a workable handful in view rather than a forest or nothing", () => {
    const trees = treesNear({ x: 128, y: 128 }, 20);
    expect(trees.length).toBeGreaterThan(0);
    expect(trees.length).toBeLessThan(32);
  });

  it("grow only where they can: trees on grass, and nothing inside a landform", () => {
    for (const tree of treesNear({ x: 90, y: 30 }, 40)) {
      expect(terrainAt(tree)).toBe("grass");
      expect(blockedByLand(tree)).toBe(false);
    }
    for (const puddle of puddlesNear({ x: 90, y: 30 }, 40)) {
      expect(blockedByLand(puddle)).toBe(false);
      expect(puddle.size).toBeGreaterThan(0);
    }
  });

  it("come out of the chunk cache exactly as the direct sweep finds them, in the same order", () => {
    const spec: FeatureSpec = { seed: 0x3a1c, density: 0.05, minSize: 2, maxSize: 6, grows: () => true };
    for (const [centre, reach] of [
      [{ x: 128, y: 128 }, 20],
      [{ x: 1.5, y: 250.2 }, 33],
      [{ x: 77.3, y: 3 }, 65],
      [{ x: 200, y: 100 }, 0.4],
    ] as const) {
      expect(cachedFeaturesNear(centre, reach, spec)).toEqual(featuresNear(centre, reach, spec));
    }
    // Asked again, the answer comes from the cache and is unchanged.
    expect(cachedFeaturesNear({ x: 128, y: 128 }, 20, spec)).toEqual(featuresNear({ x: 128, y: 128 }, 20, spec));
  });

  it("survive the seam", () => {
    // A reach that straddles x = 0 must not return an empty half.
    const straddling = treesNear({ x: 1, y: 1 }, 20);
    expect(straddling.some((tree) => tree.x > PLANET_TILES / 2)).toBe(true);
    expect(straddling.some((tree) => tree.x < PLANET_TILES / 2)).toBe(true);
  });
});
