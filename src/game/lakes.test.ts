import { describe, expect, it } from "vitest";

import {
  blockedGround,
  deepWater,
  dryGround,
  LAKE_BANK,
  LAKE_CELL,
  LAKE_MAX_REACH,
  LAKE_SPREAD,
  lakeDistance,
  lakeIn,
  lakesNear,
  nearLake,
  planetLakes,
  wadeDepth,
  type Lake,
} from "./lakes";
import { blockedByLand, landHeightAt } from "./landforms";
import { PLANET_TILES, wrapTile, type PlanetPoint } from "./planet";
import { createPuddle, puddleHolds } from "./puddles";
import { puddlesNear, treesNear } from "./terrain";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";

const LAKES = planetLakes();
const DEEP = LAKES.filter((lake) => lake.deep > 0);
const PONDS = LAKES.filter((lake) => lake.deep === 0);

/** A point `distance` tiles from a lake's centre, at `angle`. */
function off(lake: PlanetPoint, distance: number, angle = 0.7): PlanetPoint {
  return { x: wrapTile(lake.x + Math.cos(angle) * distance), y: wrapTile(lake.y + Math.sin(angle) * distance) };
}

describe("planetLakes", () => {
  it("puts water on the planet, deep lakes and shallow ponds both", () => {
    expect(LAKES.length).toBeGreaterThan(8);
    expect(DEEP.length).toBeGreaterThan(2);
    expect(PONDS.length).toBeGreaterThan(2);
  });

  it("is the same lakes on every call", () => {
    expect(planetLakes()).toBe(LAKES);
    expect(lakeIn(3, 5)).toEqual(lakeIn(3, 5));
  });

  it("keeps the deep core inside the nearest shore, and the shore inside the reach", () => {
    for (const lake of LAKES) {
      expect(lake.deep).toBeLessThan(lake.shore);
      expect(lake.shore).toBeLessThan(lake.reach);
      expect(lake.reach).toBeLessThanOrEqual(LAKE_MAX_REACH);
    }
  });

  it("never lets two lakes' water or banks meet", () => {
    for (const [index, lake] of LAKES.entries()) {
      for (const other of LAKES.slice(index + 1)) {
        expect(lakeDistance(lake, other)).toBeGreaterThan(lake.reach + other.reach + LAKE_BANK);
      }
    }
  });

  it("keeps every lake and its bank clear of landforms", () => {
    for (const lake of LAKES) {
      expect(landHeightAt(lake)).toBe(0);
      for (let step = 0; step < 8; step += 1) {
        expect(landHeightAt(off(lake, lake.reach, (step / 8) * Math.PI * 2))).toBe(0);
      }
    }
  });

  it("lays one lattice cell per lake at most, half a cell off the landforms' lattice", () => {
    const cellOf = (value: number): number => Math.floor(wrapTile(value - LAKE_CELL / 2) / LAKE_CELL);
    const cells = new Set(LAKES.map((lake) => `${cellOf(lake.x)},${cellOf(lake.y)}`));
    expect(cells.size).toBe(LAKES.length);
  });
});

describe("the drawn lake agrees with the planet's", () => {
  /** The lake grown as the water layer grows it, centred on the screen origin. */
  const grown = (lake: Lake) =>
    createPuddle({ id: "lake", centerX: 0, centerY: 0, radius: lake.size, seed: lake.seed, spread: LAKE_SPREAD, deep: lake.deepSize });

  it("covers its whole deep core, whichever way the world has turned", () => {
    for (const lake of DEEP) {
      const puddle = grown(lake);
      for (let step = 0; step < 32; step += 1) {
        const angle = (step / 32) * Math.PI * 2;
        // A planet disc lands on screen as the foreshortened ellipse, at any heading.
        const x = Math.round(Math.cos(angle) * lake.shore * TILE_WIDTH * 0.97);
        const y = Math.round(Math.sin(angle) * lake.shore * TILE_DEPTH * 0.97);
        expect(puddleHolds(puddle, x, y)).toBe(true);
      }
    }
  });

  it("draws the deep core the size the planet blocks", () => {
    for (const lake of DEEP) {
      const puddle = grown(lake);
      expect(puddle.deepX / TILE_WIDTH).toBeCloseTo(lake.deep, 5);
      expect(puddle.deepY / TILE_DEPTH).toBeCloseTo(lake.deep, 1);
    }
  });

  it("never draws water past the reach", () => {
    for (const lake of LAKES.slice(0, 6)) {
      for (const pixel of grown(lake).water) {
        expect(Math.hypot(pixel.x / TILE_WIDTH, pixel.y / TILE_DEPTH)).toBeLessThan(lake.reach);
      }
    }
  });
});

describe("walking", () => {
  it("blocks the deep core and nothing round it", () => {
    for (const lake of DEEP) {
      expect(deepWater(lake)).toBe(true);
      expect(blockedGround(off(lake, lake.deep * 0.9))).toBe(true);
      expect(deepWater(off(lake, lake.deep + 0.2))).toBe(false);
    }
  });

  it("never blocks a pond", () => {
    for (const lake of PONDS) {
      expect(deepWater(lake)).toBe(false);
    }
  });

  it("still blocks what the land blocks", () => {
    const rock = Array.from({ length: PLANET_TILES }, (_unused, index) => ({ x: index, y: index })).find(blockedByLand);
    expect(rock).toBeDefined();
    expect(blockedGround(rock as PlanetPoint)).toBe(true);
  });

  it("wades deeper toward the core, from nothing at the shore", () => {
    const lake = DEEP[0] as Lake;
    expect(wadeDepth(off(lake, lake.shore))).toBe(0);
    const halfway = wadeDepth(off(lake, (lake.shore + lake.deep) / 2));
    expect(halfway).toBeGreaterThan(0.3);
    expect(halfway).toBeLessThan(0.7);
    expect(wadeDepth(off(lake, lake.deep))).toBe(1);
    expect(wadeDepth(off(lake, lake.reach + 1))).toBe(0);
  });

  it("never wades past halfway in a pond", () => {
    for (const lake of PONDS) {
      expect(wadeDepth(lake)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("what keeps out of a lake", () => {
  it("grows no tree or puddle in or beside one", () => {
    for (const lake of LAKES.slice(0, 8)) {
      for (const feature of [...treesNear(lake, lake.reach + 1), ...puddlesNear(lake, lake.reach + 1)]) {
        expect(lakeDistance(lake, feature)).toBeGreaterThanOrEqual(lake.reach);
      }
    }
  });

  it("finds dry ground by the nearest open point", () => {
    const lake = LAKES[0] as Lake;
    const dry = dryGround(lake);
    expect(nearLake(dry, 1)).toBe(false);
    expect(blockedByLand(dry)).toBe(false);
    expect(lakeDistance(lake, dry)).toBeLessThan(lake.reach + 4);
    const open = off(lake, lake.reach + LAKE_BANK + 2);
    if (!blockedByLand(open) && !nearLake(open, 1)) {
      expect(dryGround(open)).toEqual(open);
    }
  });
});

describe("lakesNear", () => {
  it("finds a lake from across the planet's seam", () => {
    const lake = LAKES[0] as Lake;
    const across = { x: lake.x + PLANET_TILES, y: lake.y - PLANET_TILES };
    expect(lakesNear(across, 1)).toContain(lake);
  });

  it("is a square sweep, independent of heading", () => {
    const lake = LAKES[0] as Lake;
    expect(lakesNear(off(lake, 3, 0), 3.01)).toContain(lake);
    expect(lakesNear(off(lake, 3, 0), 2.9)).not.toContain(lake);
  });
});
