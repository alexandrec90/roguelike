import { describe, expect, it } from "vitest";

import { INK_COLORS, type InkId } from "../ink";
import { TILE_DEPTH, TILE_WIDTH } from "../projection";
import {
  contactShade,
  groundTile,
  packGroundKey,
  pathCover,
  unpackGroundKey,
  type GroundTileKey,
} from "./ground-tiles";

const family = (ink: InkId | null): string => (ink === null ? "none" : ink.slice(0, ink.lastIndexOf("-")));

function count(inks: readonly (InkId | null)[], of: string): number {
  return inks.filter((ink) => family(ink) === of).length;
}

describe("ground tile keys", () => {
  it("round-trip through their packed form", () => {
    const key: GroundTileKey = { dirt: 0b101010011, colours: 0b110011001, middle: 5, shade: 6 };
    expect(unpackGroundKey(packGroundKey(key))).toEqual(key);
  });
});

describe("generated ground", () => {
  it("is a full, opaque 16x12 tile of real inks", () => {
    for (let middle = 0; middle < 8; middle += 1) {
      const tile = groundTile({ dirt: middle * 61, colours: middle * 37, middle, shade: middle & 7 });
      expect(tile.width).toBe(TILE_WIDTH);
      expect(tile.height).toBe(TILE_DEPTH);
      for (const ink of tile.inks) {
        expect(ink).not.toBeNull();
        expect(INK_COLORS[ink as InkId]).toMatch(/^#/);
      }
    }
  });

  it("is meadow where there is no path, and earth where it is all path", () => {
    const meadow = groundTile({ dirt: 0, colours: 0, middle: 0, shade: 0 });
    const path = groundTile({ dirt: 0x1ff, colours: 0, middle: 0, shade: 0 });
    expect(count(meadow.inks, "grass")).toBe(meadow.inks.length);
    expect(count(path.inks, "grass")).toBe(0);
    expect(count(path.inks, "earth")).toBeGreaterThan(path.inks.length * 0.9);
  });

  it("is a pure function of its key", () => {
    const key = { dirt: 0b010010010, colours: 0b011, middle: 3, shade: 2 };
    expect(groundTile(key).inks).toEqual(groundTile(key).inks);
  });

  it("keeps its details off the edges, where a neighbour could cut them", () => {
    for (let middle = 0; middle < 8; middle += 1) {
      const tile = groundTile({ dirt: 0, colours: 0b1010, middle, shade: 0 });
      for (let y = 0; y < TILE_DEPTH; y += 1) {
        for (let x = 0; x < TILE_WIDTH; x += 1) {
          if (x === 0 || y === 0 || x === TILE_WIDTH - 1 || y === TILE_DEPTH - 1) {
            expect(family(tile.inks[y * TILE_WIDTH + x] ?? null)).toBe("grass");
          }
        }
      }
    }
  });

  it("carries details somewhere, so the variants are not all plain", () => {
    const details = Array.from({ length: 8 }, (_unused, middle) =>
      groundTile({ dirt: 0, colours: 0, middle, shade: 0 }).inks.filter((ink) => !family(ink).startsWith("grass")).length,
    );
    expect(details.filter((n) => n > 0).length).toBeGreaterThanOrEqual(4);
  });
});

describe("the path border", () => {
  it("agrees on both sides of a join that shares its lattice nodes", () => {
    // A's east column of nodes is B's west column: equal bits, equal cover.
    const a = 0b010_010_010 | 0b100_100_100;
    const b = 0b001_001_001;
    for (let y = 0; y < TILE_DEPTH; y += 1) {
      expect(pathCover(a, TILE_WIDTH - 0.5, y)).toBeCloseTo(pathCover(b, -0.5, y), 5);
    }
  });

  it("is 0 on open meadow and 1 on a solid path", () => {
    expect(pathCover(0, 7, 5)).toBe(0);
    expect(pathCover(0x1ff, 7, 5)).toBe(1);
  });
});

describe("contact shadow", () => {
  it("is absent without rock behind, and falls off within four rows", () => {
    expect(contactShade(0, 8, 0)).toBe(0);
    expect(contactShade(2, 8, 0)).toBeGreaterThan(contactShade(2, 8, 2));
    expect(contactShade(2, 8, 4)).toBe(0);
  });

  it("tapers where the outcrop behind ends", () => {
    expect(contactShade(2, 0, 0)).toBeLessThan(contactShade(7, 0, 0));
    expect(contactShade(2, TILE_WIDTH - 1, 0)).toBeLessThan(contactShade(2, 8, 0));
  });
});
