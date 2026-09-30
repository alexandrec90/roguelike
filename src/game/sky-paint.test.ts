import { describe, expect, it } from "vitest";

import { atmosphereAt } from "./atmosphere";
import { hexToRgb } from "./color";
import { horizonLayout } from "./horizon";
import { bufferPixel, createBuffer } from "./pixel-buffer";
import { SkyPainter, unlitHaze } from "./sky-paint";

const LAYOUT = horizonLayout(180);

function paint(hours: number, overcast = 0, offset = 0): ReturnType<typeof createBuffer> {
  const buffer = createBuffer(320, LAYOUT.skyHeight);
  new SkyPainter(buffer, LAYOUT).paint(atmosphereAt(hours, overcast), offset, 0, 0);
  return buffer;
}

function brightness(buffer: ReturnType<typeof createBuffer>, y: number): number {
  let sum = 0;
  for (let x = 0; x < buffer.width; x += 1) {
    const [r, g, b] = bufferPixel(buffer, x, y);
    sum += r + g + b;
  }
  return sum / buffer.width;
}

describe("painting the sky band", () => {
  it("fills every pixel of the band, opaque", () => {
    const buffer = paint(13);
    for (let y = 0; y < buffer.height; y += 3) {
      for (let x = 0; x < buffer.width; x += 7) {
        expect(bufferPixel(buffer, x, y)[3]).toBe(255);
      }
    }
  });

  it("is bright by day and dark by night", () => {
    expect(brightness(paint(13), 2)).toBeGreaterThan(brightness(paint(1), 2) * 2);
  });

  it("paints the sky pre-divided by the ambient, so the night pass lands it on the atmosphere's colour", () => {
    const night = atmosphereAt(1);
    const zenith = hexToRgb(night.skyTop);
    const ambient = hexToRgb(night.ambient);
    const [r, g, b] = bufferPixel(paint(1), 160, 0);
    // Multiplied back by the ambient, the painted zenith lands near the key's.
    expect(Math.abs((r * ambient.r) / 255 - zenith.r)).toBeLessThan(12);
    expect(Math.abs((g * ambient.g) / 255 - zenith.g)).toBeLessThan(12);
    expect(Math.abs((b * ambient.b) / 255 - zenith.b)).toBeLessThan(16);
  });

  it("turns with the bearing, and repeats for a moment", () => {
    const a = paint(15, 0.3, 0);
    const b = paint(15, 0.3, 200);
    expect(a.data).not.toEqual(b.data);
    expect(paint(15, 0.3, 0).data).toEqual(a.data);
  });

  it("leaves the roll below the horizon line to the ground", () => {
    const buffer = createBuffer(320, LAYOUT.bandHeight);
    new SkyPainter(buffer, LAYOUT).paint(atmosphereAt(13), 0, 0, 0);
    for (let x = 0; x < buffer.width; x += 7) {
      expect(bufferPixel(buffer, x, LAYOUT.horizonY - 1)[3]).toBe(255);
      expect(bufferPixel(buffer, x, LAYOUT.horizonY)[3]).toBe(0);
    }
  });
});

describe("the haze the roll dissolves into", () => {
  it("lands on the atmosphere's haze once the lighting pass multiplies it back", () => {
    for (const hours of [1, 7, 13, 19]) {
      const atmosphere = atmosphereAt(hours);
      const air = hexToRgb(atmosphere.haze);
      const ambient = hexToRgb(atmosphere.ambient);
      const haze = unlitHaze(atmosphere);
      for (const channel of ["r", "g", "b"] as const) {
        const lit = (haze[channel] * ambient[channel]) / 255;
        // Exact unless the ambient is too dark to reach the air's colour, where it clamps.
        if (haze[channel] < 255) {
          expect(Math.abs(lit - air[channel])).toBeLessThan(1.5);
        } else {
          expect(lit).toBeLessThanOrEqual(air[channel] + 1);
        }
      }
    }
  });
});
