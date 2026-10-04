import { describe, expect, it } from "vitest";

import {
  buildMap,
  caveBlocked,
  caveCoords,
  caveMap,
  END_RADIUS,
  heightAt,
  MIN_LENGTH,
  shapeAt,
  tunnelCentre,
  tunnelWidth,
  WALL_TILES,
  type CaveMap,
} from "./cave-map";
import { planetCaves } from "./caves";
import { fromLocal } from "./planet";

const MAP = buildMap(6607);

/** Whether the floor runs unbroken from the mouth to the end, down the tunnel's middle. */
function walkable(map: CaveMap): boolean {
  for (let along = 0; along <= map.length; along += 0.25) {
    if (heightAt(map, tunnelCentre(map.seed, along), along) > 0) {
      return false;
    }
  }
  return true;
}

describe("buildMap", () => {
  it("lays out the same cave for the same seed", () => {
    const again = buildMap(6607);
    expect(again.length).toBe(MAP.length);
    expect(again.heights).toEqual(MAP.heights);
    expect(again.torches).toEqual(MAP.torches);
  });

  it("is deep, and differs from cave to cave", () => {
    expect(MAP.length).toBeGreaterThanOrEqual(MIN_LENGTH);
    expect(buildMap(1234).heights).not.toEqual(MAP.heights);
  });

  it.each([6607, 1234, 42, 9001])("seed %i: a walker can get from the mouth to the end", (seed) => {
    expect(walkable(buildMap(seed))).toBe(true);
  });

  it("opens straight ahead of the mouth, and is rock behind it", () => {
    expect(heightAt(MAP, 0, 0.5)).toBe(0);
    expect(heightAt(MAP, 0, 2)).toBe(0);
    expect(heightAt(MAP, 0, -3)).toBe(WALL_TILES);
    expect(heightAt(MAP, 6, 1)).toBe(WALL_TILES);
  });

  it("ends: rock lies past the end chamber, however you go", () => {
    const end = MAP.length;
    const centre = tunnelCentre(MAP.seed, end);
    expect(heightAt(MAP, centre, end)).toBe(0);
    expect(heightAt(MAP, centre, end + END_RADIUS + 2)).toBe(WALL_TILES);
    expect(heightAt(MAP, centre, end + 40)).toBe(WALL_TILES);
  });

  it("lights its walls, and its end", () => {
    expect(MAP.torches.length).toBeGreaterThan(MAP.length / 12);
    for (const torch of MAP.torches) {
      expect(heightAt(MAP, torch.across, torch.along)).toBe(0);
    }
    const last = MAP.torches[MAP.torches.length - 1]!;
    expect(last.along).toBeGreaterThan(MAP.length);
  });

  it("samples what the shape says", () => {
    for (const [across, along] of [
      [0.1, 5.1],
      [3.3, 20.6],
      [-7.9, 44.4],
    ] as const) {
      expect(heightAt(MAP, across, along)).toBe(Math.round(shapeAt(MAP.seed, MAP.length, across, along) * 8) / 8);
    }
  });
});

describe("the tunnel", () => {
  it("leaves the mouth straight and narrow, then wanders and widens", () => {
    expect(tunnelCentre(7, 0)).toBe(0);
    expect(tunnelWidth(7, 1)).toBeCloseTo(2.6);
    const centres = Array.from({ length: 20 }, (_unused, k) => tunnelCentre(7, 10 + k * 4));
    expect(Math.max(...centres) - Math.min(...centres)).toBeGreaterThan(1);
  });
});

describe("caveCoords and caveBlocked", () => {
  const entry = { x: 100, y: 50, turn: 1.1 };

  it("measures along the way he faced going in", () => {
    const ahead = caveCoords(entry, fromLocal(entry, { x: 0, y: 10 }));
    expect(ahead.along).toBeCloseTo(10);
    expect(ahead.across).toBeCloseTo(0);
  });

  it("stops him at the walls and lets him walk the floor", () => {
    expect(caveBlocked(MAP, entry, fromLocal(entry, { x: 0, y: 1 }))).toBe(false);
    expect(caveBlocked(MAP, entry, fromLocal(entry, { x: 0, y: -3 }))).toBe(true);
    expect(caveBlocked(MAP, entry, fromLocal(entry, { x: 9, y: 1 }))).toBe(true);
  });
});

describe("caveMap", () => {
  it("keeps one map per cave", () => {
    const cave = planetCaves()[0]!;
    expect(caveMap(cave)).toBe(caveMap(cave));
  });
});
