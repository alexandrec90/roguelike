import { describe, expect, it } from "vitest";

import {
  cellOrigin,
  columnsAcross,
  depthOf,
  DEPTH_RATIO,
  project,
  rowsDown,
  TILE_DEPTH,
  TILE_WIDTH,
  wallCapY,
  wallFaceY,
  WALL_RISE,
} from "./projection";

describe("the pitched-back camera", () => {
  it("foreshortens depth and leaves width alone", () => {
    expect(DEPTH_RATIO).toBe(TILE_DEPTH / TILE_WIDTH);
    expect(project({ x: 32, y: 0 }, 0)).toEqual({ x: 32, y: 0 });
    expect(project({ x: 0, y: TILE_WIDTH }, 0)).toEqual({ x: 0, y: TILE_DEPTH });
  });

  it("raises height straight up the screen rather than leaning it", () => {
    const flat = project({ x: 40, y: 48 }, 9);
    const raised = project({ x: 40, y: 48, z: 10 }, 9);

    expect(raised.x).toBe(flat.x);
    expect(raised.y).toBe(flat.y - 10);
  });

  it("is affine: every row is the same depth, however far away it is", () => {
    const spacings = [];
    for (let row = 0; row < 14; row += 1) {
      spacings.push(cellOrigin(0, row + 1, 9).y - cellOrigin(0, row, 9).y);
    }

    expect(new Set(spacings)).toEqual(new Set([TILE_DEPTH]));
  });

  it("snaps to whole pixels, so nothing lands on a half-pixel seam", () => {
    const point = project({ x: 3.4, y: 5.7, z: 1.2 }, 9);

    expect(Number.isInteger(point.x)).toBe(true);
    expect(Number.isInteger(point.y)).toBe(true);
  });

  it("offsets by the camera", () => {
    expect(project({ x: 64, y: 32 }, 9, { x: 16, y: 16 })).toEqual({
      x: 48,
      y: 9 + 16 * DEPTH_RATIO,
    });
  });

  it("places a cell relative to the top of the flat playfield", () => {
    expect(cellOrigin(2, 3, 9)).toEqual({ x: 2 * TILE_WIDTH, y: 9 + 3 * TILE_DEPTH });
  });

  it("stands a wall block on its cell: cap lifted, face reaching the near edge", () => {
    const cellTop = 9 + 4 * TILE_DEPTH;

    expect(wallCapY(cellTop)).toBe(cellTop - WALL_RISE);
    // The face runs from the cap's near edge to the cell's near edge, so it is
    // exactly one wall unit tall — that is what makes the block read as solid.
    expect(wallFaceY(cellTop) + WALL_RISE).toBe(cellTop + TILE_DEPTH);
  });

  it("stacks a taller block by whole wall units", () => {
    expect(wallCapY(100, 2)).toBe(100 - 2 * WALL_RISE);
    expect(wallFaceY(100, 2)).toBe(100 + TILE_DEPTH - 2 * WALL_RISE);
  });

  it("covers the render target with whole cells", () => {
    expect(columnsAcross(320)).toBe(20);
    expect(rowsDown(171)).toBe(15);
    expect(rowsDown(TILE_DEPTH * 4)).toBe(4);
    expect(rowsDown(0)).toBe(0);
  });

  it("sorts far rows behind near ones, and height behind nothing in its own row", () => {
    expect(depthOf({ x: 0, y: 3 })).toBeLessThan(depthOf({ x: 0, y: 4 }));
    expect(depthOf({ x: 0, y: 3 })).toBeLessThan(depthOf({ x: 0, y: 3, z: 8 }));
    expect(depthOf({ x: 0, y: 3, z: 8 })).toBeLessThan(depthOf({ x: 0, y: 4 }));
  });
});
