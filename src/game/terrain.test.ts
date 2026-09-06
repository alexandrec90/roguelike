import { describe, expect, it } from "vitest";

import { PLANET_TILES, wrapTile } from "./planet";
import {
  elevationAt,
  isRockAt,
  openGround,
  puddlesNear,
  terrainAt,
  treesNear,
  type Terrain,
} from "./terrain";

/** Every terrain in a wide sweep of the planet, with how often it turned up. */
function census(step: number): Record<Terrain, number> {
  const counts: Record<Terrain, number> = { grass: 0, dirt: 0, rock: 0 };
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
    // sample, not a similar one. A lattice that did not fold would put a cliff
    // at one bearing that only a walk of 256 tiles would ever find.
    for (const at of [
      { x: 0, y: 0 },
      { x: 17.5, y: 3 },
      { x: 200, y: 199 },
    ]) {
      expect(elevationAt({ x: at.x + PLANET_TILES, y: at.y })).toBeCloseTo(elevationAt(at), 12);
      expect(elevationAt({ x: at.x, y: at.y - PLANET_TILES })).toBeCloseTo(elevationAt(at), 12);
    }
  });

  it("is continuous, so it can be sampled off the lattice", () => {
    // Terrain is a field rather than a grid - that is what lets the camera turn
    // - so a point half a tile away must not be an unrelated draw.
    const here = elevationAt({ x: 60, y: 60 });
    expect(elevationAt({ x: 60.05, y: 60 })).toBeCloseTo(here, 2);
  });

  it("gives a planet that is mostly walkable, with rock and paths on it", () => {
    const counts = census(2);
    const total = counts.grass + counts.dirt + counts.rock;

    expect(counts.grass / total).toBeGreaterThan(0.5);
    expect(counts.rock / total).toBeGreaterThan(0.01);
    expect(counts.rock / total).toBeLessThan(0.3);
    expect(counts.dirt / total).toBeGreaterThan(0.005);
  });

  it("agrees with isRockAt", () => {
    for (let x = 0; x < 60; x += 3) {
      expect(isRockAt({ x, y: 71 })).toBe(terrainAt({ x, y: 71 }) === "rock");
    }
  });
});

describe("openGround", () => {
  it("returns the point itself when it is already clear", () => {
    const clear = openGround({ x: 128, y: 128 });
    expect(isRockAt(clear)).toBe(false);
  });

  it("finds standable ground next to a point inside rock", () => {
    // Find a rock cell the honest way, then ask for somewhere to stand.
    let inside: { x: number; y: number } | undefined;
    for (let x = 0; x < PLANET_TILES && inside === undefined; x += 1) {
      for (let y = 0; y < PLANET_TILES; y += 1) {
        if (isRockAt({ x, y })) {
          inside = { x, y };
          break;
        }
      }
    }
    expect(inside).toBeDefined();
    const out = openGround(inside ?? { x: 0, y: 0 });
    expect(isRockAt(out)).toBe(false);
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

  it("grow only where they can: no tree on rock, no puddle in it", () => {
    for (const tree of treesNear({ x: 90, y: 30 }, 24)) {
      expect(terrainAt(tree)).toBe("grass");
    }
    for (const puddle of puddlesNear({ x: 90, y: 30 }, 24)) {
      expect(terrainAt(puddle)).not.toBe("rock");
      expect(puddle.size).toBeGreaterThan(0);
    }
  });

  it("survive the seam", () => {
    // A reach that straddles x = 0 must not return an empty half.
    const straddling = treesNear({ x: 1, y: 1 }, 20);
    expect(straddling.some((tree) => tree.x > PLANET_TILES / 2)).toBe(true);
    expect(straddling.some((tree) => tree.x < PLANET_TILES / 2)).toBe(true);
  });
});
