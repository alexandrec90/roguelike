import { describe, expect, it } from "vitest";

import { TILE_DEPTH, TILE_WIDTH } from "../projection";
import { demoTerrain, syntheticSample } from "./field-preview";
import { groundKey, planGround } from "./ground-plan";
import { cellTerrain, DIRT } from "./ground-sample";
import { unpackGroundKey } from "./ground-tiles";

const sample = syntheticSample(14, 9, demoTerrain);
const plan = planGround(sample);

describe("the ground plan", () => {
  it("covers the grid exactly once with ground tiles", () => {
    expect(plan.width).toBe(14 * TILE_WIDTH);
    expect(plan.height).toBe(9 * TILE_DEPTH);
    expect(plan.ground).toHaveLength(14 * 9);
    const spots = new Set(plan.ground.map((cell) => `${cell.x},${cell.y}`));
    expect(spots.size).toBe(14 * 9);
    for (const cell of plan.ground) {
      expect(cell.x % TILE_WIDTH).toBe(0);
      expect(cell.y % TILE_DEPTH).toBe(0);
    }
  });

  it("is flat: every cell is a ground tile, with nothing standing and nothing shaded by it", () => {
    // The regression this guards: rock stood up out of the grid in blocks,
    // which floated over the horizon and reshaped as the camera turned. What
    // stands is a landform now, never a tile.
    expect(Object.keys(plan).sort()).toEqual(["ground", "height", "width"]);
    for (const cell of plan.ground) {
      expect(unpackGroundKey(cell.key).shade).toBe(0);
    }
  });

  it("marks the path's nodes in the cells it runs through", () => {
    const pathKeys = plan.ground.filter((cell) => unpackGroundKey(cell.key).dirt !== 0);
    expect(pathKeys.length).toBeGreaterThan(9);
    for (const cell of plan.ground) {
      const x = cell.x / TILE_WIDTH;
      const y = 8 - cell.y / TILE_DEPTH;
      if (cellTerrain(sample, x, y) === DIRT) {
        expect(unpackGroundKey(cell.key).dirt).not.toBe(0);
      }
    }
  });

  it("keys a cell the same however it is asked", () => {
    for (const cell of plan.ground) {
      expect(groundKey(sample, cell.x / TILE_WIDTH, 8 - cell.y / TILE_DEPTH)).toBe(cell.key);
    }
  });
});
