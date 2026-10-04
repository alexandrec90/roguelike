import { describe, expect, it } from "vitest";

import { floorCell, floorKeyId, floorTileCloud, FLOOR_VARIANTS, tileNoise, type FloorKey } from "./cave-floor";
import { CHAMBER_RADIUS, EXIT_GLOW } from "./caves";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";

const CAVE = { x: 40, y: 40 };

describe("floorCell", () => {
  it("is lit stone at the mouth, plain stone in the chamber and rock past its wall", () => {
    expect(floorCell(CAVE, CAVE).kind).toBe("lit");
    expect(floorCell(CAVE, { x: 40 + EXIT_GLOW + 0.5, y: 40 }).kind).toBe("stone");
    expect(floorCell(CAVE, { x: 40, y: 40 + CHAMBER_RADIUS + 0.5 }).kind).toBe("rock");
  });

  it("varies the plain stone, the same way every time for a point", () => {
    const variants = new Set<number>();
    for (let x = 0; x < 8; x += 1) {
      for (let y = 0; y < 8; y += 1) {
        const key = floorCell(CAVE, { x: 42 + x * 0.5, y: 42 + y * 0.5 });
        if (key.kind === "stone") {
          variants.add(key.variant);
          expect(key.variant).toBeLessThan(FLOOR_VARIANTS);
        }
      }
    }
    expect(variants.size).toBeGreaterThan(1);
    expect(floorCell(CAVE, { x: 43.2, y: 44.7 })).toEqual(floorCell(CAVE, { x: 43.2, y: 44.7 }));
  });
});

describe("tileNoise", () => {
  it("repeats every tile, so any two tiles meet without a seam", () => {
    for (let y = 0; y < TILE_DEPTH; y += 1) {
      expect(tileNoise(TILE_WIDTH, y, 9)).toBeCloseTo(tileNoise(0, y, 9), 9);
    }
    for (let x = 0; x < TILE_WIDTH; x += 1) {
      expect(tileNoise(x, TILE_DEPTH, 9)).toBeCloseTo(tileNoise(x, 0, 9), 9);
    }
  });
});

describe("floorTileCloud", () => {
  const keys: FloorKey[] = [
    { kind: "rock", variant: 0 },
    { kind: "lit", variant: 0 },
    ...Array.from({ length: FLOOR_VARIANTS }, (_unused, variant) => ({ kind: "stone" as const, variant })),
  ];

  it.each(keys)("$kind $variant covers its whole tile and stays inside it", (key) => {
    const cloud = floorTileCloud(key);
    const covered = new Set(cloud.map((pixel) => `${pixel.x},${pixel.y}`));
    expect(covered.size).toBe(TILE_WIDTH * TILE_DEPTH);
    for (const pixel of cloud) {
      expect(pixel.x).toBeGreaterThanOrEqual(0);
      expect(pixel.x).toBeLessThan(TILE_WIDTH);
      expect(pixel.y).toBeGreaterThanOrEqual(0);
      expect(pixel.y).toBeLessThan(TILE_DEPTH);
    }
  });

  it("keeps every tile's edge to the shared base, so variants meet seamlessly", () => {
    const edge = (key: FloorKey): string[] =>
      floorTileCloud(key)
        .slice(0, TILE_WIDTH * TILE_DEPTH)
        .filter((pixel) => pixel.x === 0 || pixel.y === 0 || pixel.x === TILE_WIDTH - 1 || pixel.y === TILE_DEPTH - 1)
        .map((pixel) => pixel.ink);
    const details = (key: FloorKey) => floorTileCloud(key).slice(TILE_WIDTH * TILE_DEPTH);
    for (let variant = 0; variant < FLOOR_VARIANTS; variant += 1) {
      expect(edge({ kind: "stone", variant })).toEqual(edge({ kind: "stone", variant: 0 }));
      for (const pixel of details({ kind: "stone", variant })) {
        expect(pixel.x).toBeGreaterThan(0);
        expect(pixel.y).toBeGreaterThan(0);
        expect(pixel.x).toBeLessThan(TILE_WIDTH - 1);
        expect(pixel.y).toBeLessThan(TILE_DEPTH - 1);
      }
    }
  });

  it("lights the mouth's stone brighter than the chamber's, and darkens the rock", () => {
    const step = (key: FloorKey): number => {
      const inks = floorTileCloud(key).map((pixel) => Number(pixel.ink.split("-")[1] ?? 0));
      return inks.reduce((sum, n) => sum + n, 0) / inks.length;
    };
    expect(step({ kind: "lit", variant: 0 })).toBeGreaterThan(step({ kind: "stone", variant: 0 }));
    expect(floorTileCloud({ kind: "rock", variant: 0 }).some((pixel) => pixel.ink === "void")).toBe(true);
  });

  it("names each tile once", () => {
    expect(new Set(keys.map(floorKeyId)).size).toBe(keys.length);
  });
});
