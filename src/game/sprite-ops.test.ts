import { describe, expect, it } from "vitest";

import { rasterizeSprite, type PixelSpriteSource } from "./pixel-art";
import { composeTiles, contentBounds, EMPTY_BOUNDS, repeatSprite, swapPalette } from "./sprite-ops";

const SOURCE: PixelSpriteSource = {
  palette: { ".": null, r: "#ff0000", b: "#0000ff" },
  rows: [".r.", "..b", "..."],
};

describe("swapPalette", () => {
  it("recolours a token without changing the silhouette", () => {
    const swapped = swapPalette(SOURCE, { r: "#00ff00" });

    expect(swapped.rows).toEqual(SOURCE.rows);
    expect(swapped.palette["r"]).toBe("#00ff00");
    expect(swapped.palette["b"]).toBe("#0000ff");
  });

  it("leaves the original untouched", () => {
    swapPalette(SOURCE, { r: "#00ff00" });

    expect(SOURCE.palette["r"]).toBe("#ff0000");
  });

  it("rejects a token the sprite does not use", () => {
    expect(() => swapPalette(SOURCE, { z: "#00ff00" })).toThrow(/does not use/);
  });

  it("can erase a token to transparent", () => {
    const swapped = swapPalette(SOURCE, { r: null });

    expect(contentBounds(swapped)).toEqual({ left: 2, top: 1, width: 1, height: 1 });
  });
});

describe("contentBounds", () => {
  it("measures the drawn pixels, not the canvas", () => {
    expect(contentBounds(SOURCE)).toEqual({ left: 1, top: 0, width: 2, height: 2 });
  });

  it("reports empty bounds for a blank source", () => {
    expect(contentBounds({ palette: { ".": null }, rows: ["...", "..."] })).toEqual(EMPTY_BOUNDS);
  });

  it("treats a fully transparent colour as blank", () => {
    const bounds = contentBounds({ palette: { ".": null, g: "#00ff0000" }, rows: ["g"] });

    expect(bounds).toEqual(EMPTY_BOUNDS);
  });

  it("rejects a token the palette does not define", () => {
    expect(() => contentBounds({ palette: { ".": null }, rows: ["x"] })).toThrow(/Unknown palette/);
  });
});

describe("repeatSprite", () => {
  it("tiles the source across both axes", () => {
    const tiled = repeatSprite({ palette: { a: "#ffffff", b: "#000000" }, rows: ["ab"] }, 3, 2);

    expect(tiled.rows).toEqual(["ababab", "ababab"]);
  });

  it("stays rasterizable at the larger size", () => {
    const tiled = repeatSprite(SOURCE, 2, 2);
    const raster = rasterizeSprite(tiled);

    expect([raster.width, raster.height]).toEqual([6, 6]);
  });

  it("rejects non-positive counts", () => {
    expect(() => repeatSprite(SOURCE, 0, 1)).toThrow(/positive integers/);
    expect(() => repeatSprite(SOURCE, 1, 1.5)).toThrow(/positive integers/);
  });
});

describe("composeTiles", () => {
  const SHARED = { ".": null, a: "#111111", b: "#222222" };
  const A: PixelSpriteSource = { palette: SHARED, rows: ["aa", "aa"] };
  const B: PixelSpriteSource = { palette: SHARED, rows: ["bb", "bb"] };

  it("splices a grid of tiles into one sprite", () => {
    const field = composeTiles(3, 2, (column, row) => ((column + row) % 2 === 0 ? A : B));

    expect(field.rows).toEqual(["aabbaa", "aabbaa", "bbaabb", "bbaabb"]);
  });

  it("merges palettes so the composed sprite still rasterizes", () => {
    const other: PixelSpriteSource = { palette: { c: "#333333" }, rows: ["cc", "cc"] };
    const field = composeTiles(2, 1, (column) => (column === 0 ? A : other));
    const raster = rasterizeSprite(field);

    expect([raster.width, raster.height]).toEqual([4, 2]);
  });

  it("refuses a token that means two different colours", () => {
    const clashing: PixelSpriteSource = { palette: { a: "#ff0000" }, rows: ["aa", "aa"] };

    expect(() => composeTiles(2, 1, (column) => (column === 0 ? A : clashing))).toThrow(
      /redefines palette token 'a'/,
    );
  });

  it("refuses a tile that is not the field's cell size", () => {
    const tall: PixelSpriteSource = { palette: SHARED, rows: ["aa", "aa", "aa"] };

    expect(() => composeTiles(2, 1, (column) => (column === 0 ? A : tall))).toThrow(
      /the field is composed of 2x2 cells/,
    );
  });

  it("rejects a field with no cells", () => {
    expect(() => composeTiles(0, 1, () => A)).toThrow(/positive integers/);
  });
});
