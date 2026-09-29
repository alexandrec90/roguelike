import { describe, expect, it } from "vitest";

import { hexToRgb } from "./color";
import { INK_COLORS } from "./ink";
import {
  bakeCloud,
  compositeOver,
  blendInk,
  blitBuffer,
  bufferPixel,
  clearBuffer,
  createBuffer,
  paintInto,
} from "./pixel-buffer";

describe("createBuffer", () => {
  it("starts transparent and rejects a degenerate size", () => {
    const buffer = createBuffer(2, 3);
    expect(buffer.data).toHaveLength(24);
    expect(bufferPixel(buffer, 1, 2)).toEqual([0, 0, 0, 0]);
    expect(() => createBuffer(0, 1)).toThrow(/positive integer/);
    expect(() => createBuffer(1.5, 1)).toThrow(/positive integer/);
  });
});

describe("blending an ink", () => {
  it("writes an opaque ink exactly", () => {
    const buffer = createBuffer(1, 1);
    blendInk(buffer, 0, 0, "grass-3");
    const { r, g, b } = hexToRgb(INK_COLORS["grass-3"]);
    expect(bufferPixel(buffer, 0, 0)).toEqual([r, g, b, 255]);
  });

  it("keeps a sheer ink sheer on an empty buffer", () => {
    const buffer = createBuffer(1, 1);
    blendInk(buffer, 0, 0, "shadow");
    const alpha = bufferPixel(buffer, 0, 0)[3];
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(255);
  });

  it("darkens what is under a shadow without replacing it", () => {
    const buffer = createBuffer(1, 1);
    blendInk(buffer, 0, 0, "meadow-4");
    const before = bufferPixel(buffer, 0, 0);
    blendInk(buffer, 0, 0, "shadow");
    const after = bufferPixel(buffer, 0, 0);
    expect(after[3]).toBe(255);
    expect(after[1]).toBeLessThan(before[1]);
    expect(after[1]).toBeGreaterThan(hexToRgb(INK_COLORS.shadow).g);
  });

  it("ignores pixels outside the buffer and a zero alpha", () => {
    const buffer = createBuffer(1, 1);
    blendInk(buffer, -1, 0, "bone");
    blendInk(buffer, 0, 5, "bone");
    blendInk(buffer, 0, 0, "bone", 0);
    expect(bufferPixel(buffer, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe("painting and baking clouds", () => {
  it("paints at an origin, later pixels winning", () => {
    const buffer = createBuffer(3, 3);
    paintInto(buffer, [{ x: 0, y: 0, ink: "bone" }, { x: 0, y: 0, ink: "fire-4" }], 1, 1);
    expect(bufferPixel(buffer, 1, 1).slice(0, 3)).toEqual(
      Object.values(hexToRgb(INK_COLORS["fire-4"])),
    );
    clearBuffer(buffer);
    expect(bufferPixel(buffer, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it("bakes a cloud into its tight box and remembers where the foot went", () => {
    const baked = bakeCloud([
      { x: -2, y: -5, ink: "bark-2" },
      { x: 3, y: 0, ink: "bark-3" },
    ]);
    expect(baked.buffer.width).toBe(6);
    expect(baked.buffer.height).toBe(6);
    expect(baked.originX).toBe(2);
    expect(baked.originY).toBe(5);
    expect(bufferPixel(baked.buffer, 0, 0)[3]).toBe(255);
    expect(bufferPixel(baked.buffer, 5, 5)[3]).toBe(255);
  });

  it("pads a bake and survives an empty cloud", () => {
    const padded = bakeCloud([{ x: 0, y: 0, ink: "bone" }], 2);
    expect(padded.buffer.width).toBe(5);
    expect(padded.originX).toBe(2);
    expect(bakeCloud([]).buffer.width).toBe(1);
  });
});

describe("compositeOver", () => {
  it("replaces under an opaque source and mixes under a sheer one", () => {
    const data = new Uint8ClampedArray([10, 20, 30, 255]);
    compositeOver(data, 0, 200, 100, 0, 1);
    expect([...data]).toEqual([200, 100, 0, 255]);
    compositeOver(data, 0, 0, 0, 0, 0.5);
    expect([...data]).toEqual([100, 50, 0, 255]);
  });

  it("builds alpha up from transparent", () => {
    const data = new Uint8ClampedArray(4);
    compositeOver(data, 0, 255, 255, 255, 0.5);
    expect(data[3]).toBe(128);
    expect(data[0]).toBe(255);
  });
});

describe("blitBuffer", () => {
  it("composites a buffer over another, clipped at the edges", () => {
    const target = createBuffer(3, 3);
    const source = bakeCloud([
      { x: 0, y: 0, ink: "stone-4" },
      { x: 1, y: 0, ink: "shadow" },
    ]).buffer;
    blitBuffer(target, source, 2, 2);
    expect(bufferPixel(target, 2, 2)[3]).toBe(255);
    blitBuffer(target, source, -1, 0);
    expect(bufferPixel(target, 0, 0)[3]).toBeGreaterThan(0);
    expect(bufferPixel(target, 0, 0)[3]).toBeLessThan(255);
  });
});
