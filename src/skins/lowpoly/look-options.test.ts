import { describe, expect, it } from "vitest";

import { lowResCanvas, parseLeaves, parseResolution, parseVolume, readLookOptions } from "./look-options";
import { LOGICAL_HEIGHT } from "./placement";

describe("the low-poly look's knobs", () => {
  it("default to the full-resolution, faceted, shaded look", () => {
    expect(readLookOptions(new URLSearchParams(""))).toEqual({ resolution: "full", leaves: "mesh", volume: false });
  });

  it("read each knob, forgiving case and spaces", () => {
    expect(readLookOptions(new URLSearchParams("res=LOW&leaves= impostor&volume=1"))).toEqual({
      resolution: "low",
      leaves: "impostor",
      volume: true,
    });
    expect(parseVolume("on")).toBe(true);
    expect(parseVolume("true")).toBe(true);
  });

  it("fall back to the default on anything else, never throw", () => {
    expect(parseResolution("320")).toBe("full");
    expect(parseResolution(null)).toBe("full");
    expect(parseLeaves("balls")).toBe("mesh");
    expect(parseVolume("0")).toBe(false);
    expect(parseVolume("yes please")).toBe(false);
    expect(parseVolume(null)).toBe(false);
  });
});

describe("lowResCanvas", () => {
  it("draws a 1080p window at exactly 180 scanlines, six device pixels to one", () => {
    expect(lowResCanvas(1920, 1080, 1)).toEqual({ width: 320, height: 180, factor: 6, cssWidth: 1920, cssHeight: 1080 });
  });

  it("counts device pixels, so a high-DPI window gets whole device squares", () => {
    const size = lowResCanvas(1280, 720, 1.5);
    expect(size.factor).toBe(6);
    expect(size.height).toBe(180);
    expect(size.cssWidth * 1.5).toBe(size.width * size.factor);
  });

  it("covers the window, overhanging it by less than one pixel", () => {
    for (const [w, h, dpr] of [
      [1000, 700, 1],
      [1366, 768, 1],
      [801, 503, 1.25],
      [2560, 1440, 2],
    ] as const) {
      const size = lowResCanvas(w, h, dpr);
      expect(size.cssWidth).toBeGreaterThanOrEqual(w);
      expect(size.cssHeight).toBeGreaterThanOrEqual(h);
      expect(size.cssWidth - w).toBeLessThan(size.factor / dpr);
      expect(size.cssHeight - h).toBeLessThan(size.factor / dpr);
      expect(Math.abs(size.height - LOGICAL_HEIGHT)).toBeLessThan(LOGICAL_HEIGHT / 2);
    }
  });

  it("never scales below one, and survives a collapsed or nonsense window", () => {
    expect(lowResCanvas(200, 100, 1)).toEqual({ width: 200, height: 100, factor: 1, cssWidth: 200, cssHeight: 100 });
    const empty = lowResCanvas(0, 0, Number.NaN);
    expect(empty.factor).toBe(1);
    expect(empty.width).toBeGreaterThanOrEqual(1);
    expect(empty.height).toBeGreaterThanOrEqual(1);
  });
});
