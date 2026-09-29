import { describe, expect, it } from "vitest";

import { cloudBounds, type PixelCloud } from "../ink";
import {
  BEND_FRAMES,
  BEND_LEVELS,
  bendFrame,
  FLAT_LEFT,
  FLAT_RIGHT,
  TUFT_FRAME,
  TUFT_KINDS,
  TUFT_SHAPES,
  tuftBuffers,
  tuftCloud,
  tuftFrame,
} from "./tufts";

function blades(cloud: PixelCloud): PixelCloud {
  return cloud.filter((pixel) => pixel.ink !== "shadow-soft");
}

/** Mean x of the topmost blade pixels: where the tips are. */
function tipX(cloud: PixelCloud): number {
  const body = blades(cloud);
  const top = Math.min(...body.map((pixel) => pixel.y));
  const tips = body.filter((pixel) => pixel.y <= top + 1);
  return tips.reduce((sum, pixel) => sum + pixel.x, 0) / tips.length;
}

describe("tuft shapes", () => {
  it("cover every kind, with grass the most common", () => {
    expect(new Set(TUFT_KINDS)).toEqual(new Set(["grass", "tall", "flower", "clover", "fern", "dry"]));
    expect(TUFT_KINDS.filter((kind) => kind === "grass").length).toBeGreaterThan(TUFT_KINDS.length / 3);
    for (const shape of TUFT_SHAPES) {
      expect(shape.blades.length).toBeGreaterThanOrEqual(6);
      expect(shape.blades.length).toBeLessThanOrEqual(14);
    }
  });

  it("put flowers only on flowering tufts", () => {
    for (const shape of TUFT_SHAPES) {
      expect(shape.flowers.length > 0).toBe(shape.kind === "flower");
    }
  });
});

describe("tuft frames", () => {
  it("fit the shared frame at every bend", () => {
    for (const shape of TUFT_SHAPES) {
      for (let bend = 0; bend < BEND_FRAMES; bend += 1) {
        const bounds = cloudBounds(tuftCloud(shape, bend));
        expect(bounds).not.toBeNull();
        expect(bounds!.left + TUFT_FRAME.originX).toBeGreaterThanOrEqual(0);
        expect(bounds!.right + TUFT_FRAME.originX).toBeLessThan(TUFT_FRAME.width);
        expect(bounds!.top + TUFT_FRAME.originY).toBeGreaterThanOrEqual(0);
        expect(bounds!.bottom + TUFT_FRAME.originY).toBeLessThan(TUFT_FRAME.height);
      }
    }
  });

  it("keep the roots still and swing the tips, further with each level", () => {
    for (const shape of TUFT_SHAPES) {
      const roots = (bend: number): string =>
        JSON.stringify(blades(tuftCloud(shape, bend)).filter((pixel) => pixel.y === 0).map((pixel) => pixel.x).sort());
      const tips = Array.from({ length: BEND_LEVELS }, (_unused, bend) => tipX(tuftCloud(shape, bend)));
      for (let bend = 1; bend < BEND_LEVELS; bend += 1) {
        expect(roots(bend)).toBe(roots(0));
        expect(tips[bend]).toBeGreaterThanOrEqual(tips[bend - 1]! - 0.35);
      }
      expect(tips[BEND_LEVELS - 1]!).toBeGreaterThan(tips[0]! + 2);
    }
  });

  it("lie flatter, and away from the side pressed, when trodden", () => {
    for (const shape of TUFT_SHAPES) {
      const upright = cloudBounds(blades(tuftCloud(shape, bendFrame(0))))!;
      const left = blades(tuftCloud(shape, FLAT_LEFT));
      const right = blades(tuftCloud(shape, FLAT_RIGHT));
      expect(cloudBounds(left)!.top).toBeGreaterThanOrEqual(upright.top);
      expect(tipX(left)).toBeLessThan(tipX(right));
    }
  });

  it("are deterministic", () => {
    const shape = TUFT_SHAPES[3]!;
    expect(tuftCloud(shape, 2)).toEqual(tuftCloud(shape, 2));
  });
});

describe("bend frames", () => {
  it("centre on no wind and saturate past the range", () => {
    expect(bendFrame(0)).toBe((BEND_LEVELS - 1) / 2);
    expect(bendFrame(-99)).toBe(0);
    expect(bendFrame(99)).toBe(BEND_LEVELS - 1);
    expect(bendFrame(Number.NaN)).toBeGreaterThanOrEqual(0);
  });

  it("index the atlas shape-major", () => {
    expect(tuftFrame(0, 0)).toBe(0);
    expect(tuftFrame(2, 3)).toBe(2 * BEND_FRAMES + 3);
    expect(tuftBuffers()).toHaveLength(TUFT_SHAPES.length * BEND_FRAMES);
  });
});
