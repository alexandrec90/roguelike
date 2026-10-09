import { describe, expect, it } from "vitest";

import { lakeDistance, planetLakes } from "../../game/lakes";
import { planetLandforms } from "../../game/landforms";
import { PLANET_TILES, wrapDelta, type PlanetPoint } from "../../game/planet";
import { terrainAt } from "../../game/terrain";
import { basinAt } from "../../game/water/puddle-field";
import { calmAt, freeToTilt, latticeVertex, SHORE } from "./ground-relief";
import { FLAT_LOOK, PAINTED_LOOK } from "./look";

/** Lattice points over the planet, every `step` tiles. */
function lattice(step: number): PlanetPoint[] {
  const count = PLANET_TILES / step;
  return Array.from({ length: count * count }, (_, i) => ({ x: (i % count) * step, y: Math.floor(i / count) * step }));
}

describe("the flat look's lattice", () => {
  it("has only a hair of relief, and sits on its grid point but for the jitter", () => {
    for (const point of lattice(16)) {
      const [x, y, z] = latticeVertex(point.x, point.y, FLAT_LOOK);
      expect(Math.abs(z)).toBeLessThanOrEqual(FLAT_LOOK.relief);
      expect(Math.abs(x - point.x)).toBeLessThan(0.5);
      expect(Math.abs(y - point.y)).toBeLessThan(0.5);
    }
  });
});

describe("the painted look's hills", () => {
  const points = lattice(2);
  const heights = points.map((p) => latticeVertex(p.x, p.y, PAINTED_LOOK)[2]);

  it("rise to most of their height somewhere, and never past it", () => {
    expect(Math.max(...heights)).toBeGreaterThan(PAINTED_LOOK.hills * 0.6);
    expect(Math.max(...heights)).toBeLessThanOrEqual(PAINTED_LOOK.hills + PAINTED_LOOK.relief);
    // Rolling, not a plateau: a good share of the land is well up off level.
    expect(heights.filter((h) => h > 0.2).length).toBeGreaterThan(points.length * 0.2);
  });

  it("lie dead level, and still, wherever a puddle can stand, so the water's mirror at height 0 is true", () => {
    let wet = 0;
    points.forEach((p, i) => {
      if (basinAt(p, terrainAt(p) === "dirt") >= 0.58) {
        wet += 1;
        expect(heights[i]).toBe(0);
        expect(calmAt(p.x, p.y)).toBe(0);
      }
    });
    expect(wet).toBeGreaterThan(100);
  });

  it("lie level on a lake's shore and round a landform's foot", () => {
    points.forEach((p, i) => {
      for (const lake of planetLakes()) {
        if (lakeDistance(lake, p) <= lake.reach + SHORE) {
          expect(heights[i]).toBe(0);
        }
      }
      for (const landform of planetLandforms()) {
        if (Math.hypot(wrapDelta(p.x, landform.x), wrapDelta(p.y, landform.y)) <= landform.radius + 2) {
          expect(heights[i]).toBe(0);
        }
      }
    });
  });

  it("leave a good share of the ground free to tilt into a plane, and none where water can stand", () => {
    // Measured at 27%: about a third of open ground could hold water, and the landforms' feet are out.
    const free = points.filter((p) => freeToTilt(p.x, p.y, 2)).length;
    expect(free).toBeGreaterThan(points.length * 0.2);
    expect(free).toBeLessThan(points.length);
    points.forEach((p) => {
      if (basinAt(p, terrainAt(p) === "dirt") >= 0.58) {
        expect(freeToTilt(p.x, p.y, 1)).toBe(false);
      }
    });
    for (const landform of planetLandforms()) {
      expect(freeToTilt(Math.floor(landform.x), Math.floor(landform.y), 1)).toBe(false);
    }
  });

  it("close round the planet's seam: a lattice point is the same point a lap on", () => {
    for (const y of [0, 37, 128, 255]) {
      const [x0, y0, z0] = latticeVertex(0, y, PAINTED_LOOK);
      const [x1, y1, z1] = latticeVertex(PLANET_TILES, y, PAINTED_LOOK);
      expect(x1 - PLANET_TILES).toBeCloseTo(x0, 9);
      expect([y1, z1]).toEqual([y0, z0]);
      expect(calmAt(PLANET_TILES, y)).toBe(calmAt(0, y));
    }
  });
});
