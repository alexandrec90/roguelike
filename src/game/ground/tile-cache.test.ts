import { describe, expect, it } from "vitest";

import { rasterizeSprite } from "../pixel-art";
import { createGrid, gridToPixels, gridToSprite, packedInk, setGrid } from "./ink-grid";
import { blitWords, createTileCache } from "./tile-cache";

describe("the tile cache", () => {
  it("generates a key once and then only hands back the same pixels", () => {
    let calls = 0;
    const cache = createTileCache(2, 2, (key) => {
      calls += 1;
      return createGrid(2, 2, key === 0 ? "grass-2" : "earth-3");
    });
    expect(cache.peek(0)).toBeUndefined();
    expect(calls).toBe(0);
    const first = cache.get(0);
    expect(cache.peek(0)).toBe(first);
    expect(cache.get(0)).toBe(first);
    cache.get(1);
    expect(calls).toBe(2);
    expect(cache.baked()).toBe(2);
    expect(cache.size()).toBe(2);
  });

  it("clears rather than growing past its limit", () => {
    const cache = createTileCache(1, 1, () => createGrid(1, 1, "grass-1"), 4);
    for (let key = 0; key < 10; key += 1) {
      cache.get(key);
    }
    expect(cache.size()).toBeLessThanOrEqual(4);
  });

  it("refuses a generator that returns the wrong size", () => {
    const cache = createTileCache(2, 2, () => createGrid(3, 2, "grass-1"));
    expect(() => cache.get(0)).toThrow(/expected 2x2/);
  });
});

describe("word blits", () => {
  const tile = gridToPixels((() => {
    const grid = createGrid(2, 2, "stone-3");
    setGrid(grid, 1, 1, null);
    return grid;
  })());

  it("copy opaque tiles whole and clip at every edge", () => {
    const target = { width: 3, height: 3, words: new Uint32Array(9) };
    blitWords(target, tile, 2, 2, 2, true);
    expect(target.words[8]).toBe(packedInk("stone-3"));
    expect([...target.words.slice(0, 8)]).toEqual(Array(8).fill(0));
    blitWords(target, tile, 2, -1, -1, true);
    expect(target.words[0]).toBe(0);
  });

  it("leave the target alone under a transparent pixel", () => {
    const target = { width: 2, height: 2, words: new Uint32Array(4).fill(7) };
    blitWords(target, tile, 2, 0, 0, false);
    expect(target.words[3]).toBe(7);
    expect(target.words[0]).toBe(packedInk("stone-3"));
  });
});

describe("ink grids", () => {
  it("become lab sprites with transparent holes", () => {
    const grid = createGrid(3, 2, "moss-2");
    setGrid(grid, 0, 0, null);
    const raster = rasterizeSprite(gridToSprite(grid));
    expect(raster.width).toBe(3);
    expect(raster.rgba[3]).toBe(0);
    expect(raster.rgba[7]).toBe(255);
  });

  it("pack an ink as little-endian RGBA", () => {
    const bytes = new Uint8Array(new Uint32Array([packedInk("shadow")]).buffer);
    expect(bytes[3]).toBeLessThan(255);
    expect(bytes[3]).toBeGreaterThan(0);
    expect(packedInk("grass-3") >>> 24).toBe(255);
  });

  it("reject an empty grid", () => {
    expect(() => createGrid(0, 2)).toThrow(/positive/);
  });
});
