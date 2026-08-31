import { describe, expect, it } from "vitest";

import { centerRect, filmstripCells, splitPanes, type Rect } from "./lab-layout";

const STAGE: Rect = { x: 0, y: 0, width: 320, height: 120 };

describe("filmstripCells", () => {
  it("lays cells out left to right on whole pixels", () => {
    const cells = filmstripCells({
      count: 3,
      cellWidth: 16,
      cellHeight: 16,
      gap: 2,
      maxWidth: 320,
      originX: 4,
      originY: 8,
    });

    expect(cells.map((cell) => cell.x)).toEqual([4, 22, 40]);
    expect(cells.every((cell) => cell.y === 8)).toBe(true);
  });

  it("wraps into a second row once the width is used up", () => {
    const cells = filmstripCells({
      count: 4,
      cellWidth: 16,
      cellHeight: 16,
      gap: 2,
      maxWidth: 34,
      originX: 0,
      originY: 0,
    });

    expect(cells.map((cell) => [cell.x, cell.y])).toEqual([
      [0, 0],
      [18, 0],
      [0, 18],
      [18, 18],
    ]);
  });

  it("keeps one cell per row when nothing else fits", () => {
    const cells = filmstripCells({
      count: 2,
      cellWidth: 40,
      cellHeight: 10,
      gap: 2,
      maxWidth: 20,
      originX: 0,
      originY: 0,
    });

    expect(cells.map((cell) => cell.y)).toEqual([0, 12]);
  });

  it("returns nothing for an empty clip", () => {
    const options = {
      count: 0,
      cellWidth: 8,
      cellHeight: 8,
      gap: 1,
      maxWidth: 40,
      originX: 0,
      originY: 0,
    };

    expect(filmstripCells(options)).toEqual([]);
  });

  it("rejects impossible cells", () => {
    const options = {
      count: 1,
      cellWidth: 0,
      cellHeight: 8,
      gap: 1,
      maxWidth: 40,
      originX: 0,
      originY: 0,
    };

    expect(() => filmstripCells(options)).toThrow(/Cell size/);
    expect(() => filmstripCells({ ...options, cellWidth: 8, count: -1 })).toThrow(/negative/);
  });
});

describe("centerRect", () => {
  it("centres on integer pixels", () => {
    expect(centerRect(64, 64, STAGE)).toEqual({ x: 128, y: 28, width: 64, height: 64 });
  });

  it("biases the odd pixel left and up rather than onto a half pixel", () => {
    expect(centerRect(31, 31, { x: 0, y: 0, width: 100, height: 100 })).toMatchObject({
      x: 34,
      y: 34,
    });
  });
});

describe("splitPanes", () => {
  it("gives both panes the same width", () => {
    const [left, right] = splitPanes(STAGE, 8);

    expect(left.width).toBe(right.width);
    expect(left.x).toBe(0);
    expect(right.x + right.width).toBe(320);
  });

  it("leaves at least the gutter between them", () => {
    const [left, right] = splitPanes(STAGE, 8);

    expect(right.x - (left.x + left.width)).toBeGreaterThanOrEqual(8);
  });
});
