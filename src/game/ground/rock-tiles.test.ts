import { describe, expect, it } from "vitest";

import type { InkId } from "../ink";
import { TILE_DEPTH, TILE_WIDTH, WALL_RISE } from "../projection";
import { gridAt, type InkGrid } from "./ink-grid";
import {
  capTile,
  faceTile,
  packCapKey,
  packFaceKey,
  ROCK_EAST,
  ROCK_NORTH,
  ROCK_SOUTH,
  ROCK_WEST,
  rimLight,
  unpackCapKey,
  unpackFaceKey,
} from "./rock-tiles";

const ALL = ROCK_NORTH | ROCK_EAST | ROCK_SOUTH | ROCK_WEST;

function opaque(grid: InkGrid): number {
  return grid.inks.filter((ink) => ink !== null).length;
}

/** Mean ramp index of a row's stone pixels. */
function rowLevel(grid: InkGrid, y: number): number {
  const levels: number[] = [];
  for (let x = 0; x < grid.width; x += 1) {
    const ink = gridAt(grid, x, y);
    if (ink?.startsWith("stone-") === true) {
      levels.push(Number(ink.slice(6)));
    }
  }
  return levels.reduce((sum, level) => sum + level, 0) / Math.max(1, levels.length);
}

describe("rock keys", () => {
  it("round-trip", () => {
    const cap = { rock: 9, colours: 0b101100111, middle: 6 };
    expect(unpackCapKey(packCapKey(cap))).toEqual(cap);
    const face = { openLeft: true, openRight: false, colours: 5, middle: 2 };
    expect(unpackFaceKey(packFaceKey(face))).toEqual(face);
  });
});

describe("rock caps", () => {
  it("are 16x12 and solid inside a mass", () => {
    const cap = capTile({ rock: ALL, colours: 0b10101, middle: 1 });
    expect(cap.width).toBe(TILE_WIDTH);
    expect(cap.height).toBe(TILE_DEPTH);
    expect(opaque(cap)).toBe(TILE_WIDTH * TILE_DEPTH);
  });

  it("chip only convex corners round", () => {
    const lone = capTile({ rock: 0, colours: 0, middle: 0 });
    for (const [x, y] of [[0, 0], [TILE_WIDTH - 1, 0], [0, TILE_DEPTH - 1], [TILE_WIDTH - 1, TILE_DEPTH - 1]] as const) {
      expect(gridAt(lone, x, y)).toBeNull();
    }
    // Open behind but rock to the left: the back-left corner is a straight edge.
    const run = capTile({ rock: ROCK_WEST | ROCK_EAST | ROCK_SOUTH, colours: 0, middle: 0 });
    expect(gridAt(run, 0, 0)).not.toBeNull();
    expect(gridAt(run, TILE_WIDTH - 1, 0)).not.toBeNull();
  });

  it("carry no vertical lines, because a cap is a surface", () => {
    for (let colours = 0; colours < 64; colours += 7) {
      const cap = capTile({ rock: ALL, colours, middle: colours % 8 });
      for (let x = 0; x < TILE_WIDTH; x += 1) {
        let run = 0;
        for (let y = 0; y < TILE_DEPTH; y += 1) {
          run = gridAt(cap, x, y) === "stone-1" ? run + 1 : 0;
          expect(run).toBeLessThan(4);
        }
      }
    }
  });

  it("light their back rim where the outcrop ends behind them", () => {
    const rimmed = capTile({ rock: ROCK_SOUTH | ROCK_EAST | ROCK_WEST, colours: 0, middle: 0 });
    const inner = capTile({ rock: ALL, colours: 0, middle: 0 });
    const lit = (grid: InkGrid): number =>
      Array.from({ length: TILE_WIDTH }, (_unused, x) => gridAt(grid, x, 0)).filter(
        (ink: InkId | null) => ink === "stone-5" || ink === "stone-4" || ink?.startsWith("moss") === true,
      ).length;
    expect(lit(rimmed)).toBeGreaterThan(lit(inner));
  });
});

describe("rimLight (the level shadeCapPixel adds at an open side)", () => {
  const closed = { left: false, right: false, top: false, bottom: false };

  it("is nothing inside a mass", () => {
    expect(rimLight(closed)).toBe(0);
  });

  it("lights the sides facing the top-left light and shades the others", () => {
    expect(rimLight({ ...closed, left: true })).toBeGreaterThan(0);
    expect(rimLight({ ...closed, top: true })).toBeGreaterThan(0);
    expect(rimLight({ ...closed, right: true })).toBeLessThan(0);
    expect(rimLight({ ...closed, bottom: true })).toBeLessThan(0);
  });
});

describe("rock faces", () => {
  it("are 16 by WALL_RISE", () => {
    const face = faceTile({ openLeft: false, openRight: false, colours: 0, middle: 0 });
    expect(face.width).toBe(TILE_WIDTH);
    expect(face.height).toBe(WALL_RISE);
    expect(opaque(face)).toBe(TILE_WIDTH * WALL_RISE);
  });

  it("round an open end and leave a closed one square", () => {
    const left = faceTile({ openLeft: true, openRight: false, colours: 0, middle: 0 });
    expect(gridAt(left, 0, 0)).toBeNull();
    expect(gridAt(left, TILE_WIDTH - 1, 0)).not.toBeNull();
  });

  it("darken toward the foot, but carry no band that reads as the bottom", () => {
    const face = faceTile({ openLeft: false, openRight: false, colours: 3, middle: 4 });
    expect(rowLevel(face, WALL_RISE - 1)).toBeLessThan(rowLevel(face, 3));
    // No row is a single ink across its whole width.
    for (let y = 1; y < WALL_RISE; y += 1) {
      const inks = new Set(Array.from({ length: TILE_WIDTH }, (_unused, x) => gridAt(face, x, y)));
      expect(inks.size).toBeGreaterThan(1);
    }
  });

  it("wear a lit lip", () => {
    const face = faceTile({ openLeft: false, openRight: false, colours: 0, middle: 0 });
    expect(rowLevel(face, 0)).toBeGreaterThanOrEqual(4);
  });
});
