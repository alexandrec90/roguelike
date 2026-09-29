import { describe, expect, it } from "vitest";

import { TILE_DEPTH, TILE_WIDTH } from "../projection";
import { demoTerrain, syntheticSample } from "./field-preview";
import { dirtOf } from "./ground-plan";
import { cellTerrain, ROCK } from "./ground-sample";
import { pathCover } from "./ground-tiles";
import { inWater, placeTufts, windBetween, windGrid, WIND_SPACING } from "./tuft-placement";
import { TUFT_SHAPES } from "./tufts";

const sample = syntheticSample(14, 9, demoTerrain);
const tufts = placeTufts(sample);

function cellOf(x: number, y: number): { localX: number; localY: number; dx: number; dy: number } {
  const column = Math.floor(x / TILE_WIDTH);
  const row = Math.floor(y / TILE_DEPTH);
  return { localX: column, localY: 8 - row, dx: x - column * TILE_WIDTH, dy: y - row * TILE_DEPTH };
}

describe("tuft placement", () => {
  it("grows one to three tufts in most grass cells", () => {
    expect(tufts.length).toBeGreaterThan(14 * 9);
    const perCell = new Map<string, number>();
    for (const tuft of tufts) {
      const cell = cellOf(tuft.x, tuft.y);
      const key = `${cell.localX},${cell.localY}`;
      perCell.set(key, (perCell.get(key) ?? 0) + 1);
      expect(cell.localY).toBe(tuft.localY);
    }
    for (const count of perCell.values()) {
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(3);
    }
  });

  it("never roots a tuft on rock or on the visible path", () => {
    for (const tuft of tufts) {
      const cell = cellOf(tuft.x, tuft.y);
      expect(cellTerrain(sample, cell.localX, cell.localY)).not.toBe(ROCK);
      expect(pathCover(dirtOf(sample, cell.localX, cell.localY), cell.dx, cell.dy)).toBeLessThanOrEqual(0.3);
    }
  });

  it("is seeded from the ground, not from chance", () => {
    expect(placeTufts(sample)).toEqual(tufts);
    for (const tuft of tufts) {
      expect(TUFT_SHAPES[tuft.shape]).toBeDefined();
      expect(tuft.flex).toBeGreaterThan(0.5);
    }
  });

  it("uses more than a couple of shapes across a field", () => {
    expect(new Set(tufts.map((tuft) => tuft.shape)).size).toBeGreaterThan(5);
  });
});

describe("tufts and standing water", () => {
  const tuft = tufts[0]!;

  it("keeps a tuft out of a puddle it is rooted in, and only then", () => {
    expect(inWater(tuft, [{ x: tuft.x, y: tuft.y, radius: 6 }])).toBe(true);
    expect(inWater(tuft, [{ x: tuft.x + 40, y: tuft.y, radius: 6 }])).toBe(false);
    expect(inWater(tuft, [])).toBe(false);
  });

  it("allows for the puddle being foreshortened: deep reaches less far than across", () => {
    expect(inWater(tuft, [{ x: tuft.x + 9, y: tuft.y, radius: 6 }])).toBe(true);
    expect(inWater(tuft, [{ x: tuft.x, y: tuft.y + 9, radius: 6 }])).toBe(false);
  });

  it("names the cell's planet point, for a bare-ground test", () => {
    expect(Number.isFinite(tuft.planetX)).toBe(true);
    expect(Number.isFinite(tuft.planetY)).toBe(true);
  });
});

describe("the wind grid", () => {
  const grid = windGrid(sample);

  it("spans the lattice at its spacing", () => {
    expect(grid.width).toBe(Math.ceil((sample.latticeWidth - 1) / WIND_SPACING) + 1);
    expect(grid.height).toBe(Math.ceil((sample.latticeHeight - 1) / WIND_SPACING) + 1);
  });

  it("interpolates between nodes and matches them exactly on one", () => {
    grid.value.forEach((_value, index) => {
      grid.value[index] = index;
    });
    expect(windBetween(grid, 1, 1)).toBeCloseTo(grid.width + 1, 3);
    const between = windBetween(grid, 1.5, 1);
    expect(between).toBeGreaterThan(grid.width + 1);
    expect(between).toBeLessThan(grid.width + 2);
    expect(Number.isFinite(windBetween(grid, -5, 99))).toBe(true);
  });

  it("puts every tuft inside the grid", () => {
    for (const tuft of tufts) {
      expect(tuft.windU).toBeGreaterThanOrEqual(0);
      expect(tuft.windU).toBeLessThanOrEqual(grid.width - 1);
      expect(tuft.windV).toBeGreaterThanOrEqual(0);
      expect(tuft.windV).toBeLessThanOrEqual(grid.height - 1);
    }
  });
});
