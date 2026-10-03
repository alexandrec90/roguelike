import { describe, expect, it } from "vitest";

import { CLEAR_SKY, CLOUD_TILE_HEIGHT, CLOUD_TILE_WIDTH, cloudShade, cloudTile, tileOrigins } from "./cloud-shadow";

describe("cloudShade", () => {
  const tile = cloudTile();

  it("is clear sky - full light, one key - when the clouds cast nothing", () => {
    expect(cloudShade({ x: 3, y: 4, strength: 0 }, 4)).toBe(CLEAR_SKY);
    expect(CLEAR_SKY.at(10, 10)).toBe(1);
    expect(CLEAR_SKY.tint(10, 10)).toBe(0xffffff);
  });

  it("reads the very pixel the lighting pass stamps there, its margin and drift included", () => {
    // The pass draws into a texture offset by `margin`, tiled from origins the
    // drift decides: screen (x, y) is tile ((x + margin - drift) mod size).
    const clouds = { x: 37.4, y: -12.6, strength: 1 };
    const margin = 4;
    const shade = cloudShade(clouds, margin, tile);
    const origins = tileOrigins(clouds.x, clouds.y, 400, 400);
    for (const [x, y] of [
      [0, 0],
      [100, 57],
      [319, 179],
    ] as const) {
      const passX = x + margin;
      const passY = y + margin;
      const origin = origins.find(
        (at) => at.x <= passX && passX < at.x + CLOUD_TILE_WIDTH && at.y <= passY && passY < at.y + CLOUD_TILE_HEIGHT,
      );
      expect(origin).toBeDefined();
      const u = passX - (origin?.x ?? 0);
      const v = passY - (origin?.y ?? 0);
      expect(shade.at(x, y)).toBeCloseTo((tile.data[(v * tile.width + u) * 4] ?? 0) / 255, 6);
    }
  });

  it("hands a shader what `at` is computed from, so the two read the same pixel", () => {
    const shade = cloudShade({ x: 37.4, y: -12.6, strength: 0.8 }, 4, tile);
    const params = shade.params;
    expect(params).toEqual({ x: 37, y: -13, strength: 0.8, margin: 4 });
    expect(CLEAR_SKY.params).toBeUndefined();
    // The shader's formula, written out: tile ((x + margin - offset) mod size).
    const at = (x: number, y: number): number => {
      const u = ((((x + (params?.margin ?? 0) - (params?.x ?? 0)) % tile.width) + tile.width) % tile.width) | 0;
      const v = ((((y + (params?.margin ?? 0) - (params?.y ?? 0)) % tile.height) + tile.height) % tile.height) | 0;
      return 1 - (1 - (tile.data[(v * tile.width + u) * 4] ?? 255) / 255) * (params?.strength ?? 0);
    };
    for (const [x, y] of [
      [0, 0],
      [160, 90],
      [319, 179],
    ] as const) {
      expect(at(x, y)).toBeCloseTo(shade.at(x, y), 9);
    }
  });

  it("scales its darkness by the clouds' strength", () => {
    const full = cloudShade({ x: 0, y: 0, strength: 1 }, 0, tile);
    const half = cloudShade({ x: 0, y: 0, strength: 0.5 }, 0, tile);
    let darkest = { x: 0, y: 0, level: 1 };
    for (let y = 0; y < 60; y += 3) {
      for (let x = 0; x < 300; x += 3) {
        if (full.at(x, y) < darkest.level) {
          darkest = { x, y, level: full.at(x, y) };
        }
      }
    }
    expect(darkest.level).toBeLessThan(1);
    expect(half.at(darkest.x, darkest.y)).toBeCloseTo(1 - (1 - darkest.level) / 2, 6);
  });

  it("changes its key as the pattern moves a pixel, and tints in grey", () => {
    const here = cloudShade({ x: 10, y: 10, strength: 0.8 }, 4, tile);
    expect(cloudShade({ x: 10.2, y: 10, strength: 0.8 }, 4, tile).key).toBe(here.key);
    expect(cloudShade({ x: 11, y: 10, strength: 0.8 }, 4, tile).key).not.toBe(here.key);
    const tint = here.tint(5, 5);
    const red = (tint >> 16) & 0xff;
    expect((tint >> 8) & 0xff).toBe(red);
    expect(red).toBe(Math.round(here.at(5, 5) * 255));
  });
});
