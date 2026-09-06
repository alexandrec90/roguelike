import { describe, expect, it } from "vitest";

import { createRaster, fillRect, paintCloud, type RasterBuffer } from "./cloud-raster";
import { INK_COLORS, type PixelCloud } from "./ink";
import { hexToRgb } from "./color";

function pixelAt(buffer: RasterBuffer, x: number, y: number): [number, number, number, number] {
  const offset = (y * buffer.width + x) * 4;
  return [
    buffer.data[offset] ?? 0,
    buffer.data[offset + 1] ?? 0,
    buffer.data[offset + 2] ?? 0,
    buffer.data[offset + 3] ?? 0,
  ];
}

describe("the raster buffer", () => {
  it("allocates four bytes a pixel, transparent", () => {
    const buffer = createRaster(4, 3);
    expect(buffer.data).toHaveLength(48);
    expect(pixelAt(buffer, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("rejects a size that is not positive integers", () => {
    expect(() => createRaster(0, 4)).toThrow(/positive integer/);
    expect(() => createRaster(4, 1.5)).toThrow(/positive integer/);
  });
});

describe("filling", () => {
  it("paints the rectangle it was given and leaves the rest alone", () => {
    const buffer = createRaster(4, 4);
    fillRect(buffer, { x: 1, y: 1, width: 2, height: 2 }, "#ff0000");
    expect(pixelAt(buffer, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(buffer, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("clips a rectangle that runs off the edge instead of wrapping", () => {
    const buffer = createRaster(3, 3);
    fillRect(buffer, { x: -2, y: -2, width: 4, height: 4 }, "#00ff00");
    expect(pixelAt(buffer, 1, 1)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(buffer, 2, 2)).toEqual([0, 0, 0, 0]);
  });
});

describe("painting a cloud", () => {
  it("writes an opaque ink straight through", () => {
    const buffer = createRaster(4, 4);
    paintCloud(buffer, [{ x: 0, y: 0, ink: "neon-green" }], 2, 2);
    const { r, g, b } = hexToRgb(INK_COLORS["neon-green"]);
    expect(pixelAt(buffer, 2, 2)).toEqual([r, g, b, 255]);
  });

  it("composites a translucent ink over what is already there", () => {
    const buffer = createRaster(2, 2);
    fillRect(buffer, { x: 0, y: 0, width: 2, height: 2 }, "#ffffff");
    paintCloud(buffer, [{ x: 0, y: 0, ink: "water" }], 0, 0);
    const [r] = pixelAt(buffer, 0, 0);
    // Water is sheer: the white underneath must still lift the result well
    // above water's own channel value, and it must not stay pure white.
    expect(r).toBeGreaterThan(hexToRgb(INK_COLORS.water).r);
    expect(r).toBeLessThan(255);
  });

  it("multiplies the ink's own alpha by the caller's, never replaces it", () => {
    const dim = createRaster(1, 1);
    const full = createRaster(1, 1);
    fillRect(dim, { x: 0, y: 0, width: 1, height: 1 }, "#000000");
    fillRect(full, { x: 0, y: 0, width: 1, height: 1 }, "#000000");
    paintCloud(dim, [{ x: 0, y: 0, ink: "bone" }], 0, 0, 0.25);
    paintCloud(full, [{ x: 0, y: 0, ink: "bone" }], 0, 0, 1);
    expect(pixelAt(dim, 0, 0)[0]).toBeLessThan(pixelAt(full, 0, 0)[0]);
  });

  it("clips pixels outside the buffer rather than wrapping to the far edge", () => {
    const buffer = createRaster(3, 3);
    const cloud: PixelCloud = [
      { x: -5, y: 0, ink: "bone" },
      { x: 99, y: 0, ink: "bone" },
      { x: 0, y: -9, ink: "bone" },
    ];
    paintCloud(buffer, cloud, 1, 1);
    expect([...buffer.data].every((byte) => byte === 0)).toBe(true);
  });

  it("honours painter's order: the later pixel wins", () => {
    const buffer = createRaster(1, 1);
    paintCloud(buffer, [
      { x: 0, y: 0, ink: "ember" },
      { x: 0, y: 0, ink: "cyan" },
    ], 0, 0);
    expect(pixelAt(buffer, 0, 0)[2]).toBe(hexToRgb(INK_COLORS.cyan).b);
  });
});
