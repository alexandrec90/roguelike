import { describe, expect, it } from "vitest";

import { quantizedWave, rasterizeSprite } from "./pixel-art";

describe("rasterizeSprite", () => {
  it("turns palette-indexed text into RGBA pixels", () => {
    const result = rasterizeSprite({
      palette: { ".": null, r: "#ff0000", h: "#00ff0080" },
      rows: ["r.", ".h"],
    });

    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(Array.from(result.rgba)).toEqual([
      255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 128,
    ]);
  });

  it("rejects uneven rows and unknown palette tokens", () => {
    expect(() =>
      rasterizeSprite({ palette: { ".": null }, rows: ["..", "."] }),
    ).toThrow("row 1 has width 1");
    expect(() => rasterizeSprite({ palette: { ".": null }, rows: ["x"] })).toThrow(
      "Unknown palette token 'x'",
    );
  });

  it("rejects empty sprites and malformed colors", () => {
    expect(() => rasterizeSprite({ palette: {}, rows: [] })).toThrow("at least one pixel");
    expect(() => rasterizeSprite({ palette: { x: "red" }, rows: ["x"] })).toThrow(
      "Invalid palette color",
    );
  });
});

describe("quantizedWave", () => {
  it("returns whole-pixel offsets", () => {
    expect(quantizedWave(0, 1000, 3)).toBe(0);
    expect(quantizedWave(250, 1000, 3)).toBe(3);
    expect(quantizedWave(750, 1000, 3)).toBe(-3);
  });

  it("rejects non-positive periods", () => {
    expect(() => quantizedWave(100, 0, 2)).toThrow("greater than zero");
  });
});
