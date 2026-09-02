import { describe, expect, it } from "vitest";

import type { PixelCloud } from "./ink";
import {
  burnCloud,
  burnFront,
  freezeCloud,
  meltCloud,
  pixelHash,
  reflectCloud,
} from "./transforms";

/** A 1-wide column standing 8 pixels tall, foot at y = 0. */
function column(): PixelCloud {
  return Array.from({ length: 8 }, (_unused, index) => ({
    x: 0,
    y: -index,
    ink: "bone" as const,
  }));
}

describe("pixelHash", () => {
  it("is deterministic, in [0, 1), and sensitive to every input", () => {
    expect(pixelHash(3, -5, 7)).toBe(pixelHash(3, -5, 7));
    expect(pixelHash(3, -5, 7)).not.toBe(pixelHash(4, -5, 7));
    expect(pixelHash(3, -5, 7)).not.toBe(pixelHash(3, -5, 8));
    expect(pixelHash(3, -5, 7, 1)).not.toBe(pixelHash(3, -5, 7, 2));
    for (let i = 0; i < 50; i += 1) {
      const value = pixelHash(i, i * 3, 99);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("meltCloud", () => {
  it("is the identity at progress 0 and deterministic per seed", () => {
    expect(meltCloud(column(), 0, 5)).toEqual(column());
    expect(meltCloud(column(), 0.5, 5)).toEqual(meltCloud(column(), 0.5, 5));
    expect(meltCloud(column(), 0.5, 5)).not.toEqual(meltCloud(column(), 0.5, 6));
  });

  it("keeps every pixel, sagging toward the ground as progress rises", () => {
    const half = meltCloud(column(), 0.5, 5);
    expect(half).toHaveLength(column().length);
    const meanY = (cloud: PixelCloud) =>
      cloud.reduce((sum, pixel) => sum + pixel.y, 0) / cloud.length;
    expect(meanY(half)).toBeGreaterThan(meanY(column()));
  });

  it("pools everything into the bottom two rows at progress 1", () => {
    const puddle = meltCloud(column(), 1, 5);
    expect(puddle.every((pixel) => pixel.y === 0 || pixel.y === -1)).toBe(true);
    // The puddle spreads wider than the column it came from.
    expect(new Set(puddle.map((pixel) => pixel.x)).size).toBeGreaterThan(1);
  });

  it("clamps progress outside 0..1", () => {
    expect(meltCloud(column(), -1, 5)).toEqual(column());
    expect(meltCloud(column(), 2, 5)).toEqual(meltCloud(column(), 1, 5));
  });
});

describe("freezeCloud", () => {
  it("is the identity at 0 and re-inks from the ground up without moving pixels", () => {
    expect(freezeCloud(column(), 0, 9)).toEqual(column());
    const half = freezeCloud(column(), 0.5, 9);
    half.forEach((pixel, index) => {
      expect(pixel.x).toBe(column()[index]?.x);
      expect(pixel.y).toBe(column()[index]?.y);
    });
    const frozenLow = half.filter((pixel) => pixel.y >= -4);
    expect(frozenLow.every((pixel) => pixel.ink === "ice" || pixel.ink === "bone")).toBe(true);
  });

  it("freezes everything at progress 1, except punched holes", () => {
    const withEye: PixelCloud = [...column(), { x: 1, y: -6, ink: "void" }];
    const solid = freezeCloud(withEye, 1, 9);
    expect(
      solid.every(
        (pixel) => pixel.ink === "ice" || pixel.ink === "bone" || pixel.ink === "void",
      ),
    ).toBe(true);
    expect(solid.find((pixel) => pixel.x === 1)?.ink).toBe("void");
  });
});

describe("burnCloud", () => {
  it("is the identity at 0, flares at the front, and consumes below it", () => {
    expect(burnCloud(column(), 0, 3)).toEqual(column());
    const half = burnCloud(column(), 0.5, 3);
    expect(half.length).toBeLessThan(column().length);
    expect(half.some((pixel) => pixel.ink === "ember" || pixel.ink === "amber")).toBe(true);
    // Whatever survives above the flare keeps its original ink.
    const top = half.find((pixel) => pixel.y === -7);
    expect(top?.ink).toBe("bone");
  });

  it("leaves nothing at progress 1", () => {
    expect(burnCloud(column(), 1, 3)).toHaveLength(0);
  });

  it("reports the flaring pixels for the particle layer", () => {
    expect(burnFront(column(), 0)).toEqual([]);
    const front = burnFront(column(), 0.5);
    expect(front.length).toBeGreaterThan(0);
    const burned = new Set(
      burnCloud(column(), 0.5, 3)
        .filter((pixel) => pixel.ink === "ember" || pixel.ink === "amber")
        .map((pixel) => `${pixel.x},${pixel.y}`),
    );
    expect(front.every((pixel) => burned.has(`${pixel.x},${pixel.y}`))).toBe(true);
  });
});

describe("reflectCloud", () => {
  it("flips below the foot line, interlaced, all in the water ink", () => {
    const reflection = reflectCloud(column());
    expect(reflection.every((pixel) => pixel.y >= 1)).toBe(true);
    expect(reflection.every((pixel) => pixel.ink === "deep")).toBe(true);
    const ys = new Set(reflection.map((pixel) => pixel.y));
    // Interlace 2 keeps only every other scanline.
    for (const y of ys) {
      expect(y % 2).toBe(1);
    }
  });

  it("squashes the reflection shorter than the model", () => {
    const reflection = reflectCloud(column(), { squash: 0.5, interlace: 1 });
    const deepest = Math.max(...reflection.map((pixel) => pixel.y));
    expect(deepest).toBeLessThan(8);
  });

  it("gives back the source inks when the water is asked for a colour image", () => {
    const mixed: PixelCloud = [
      { x: 0, y: 0, ink: "amber" },
      { x: 0, y: -1, ink: "ice" },
    ];
    const reflection = reflectCloud(mixed, { interlace: 1, ink: null });
    expect(new Set(reflection.map((pixel) => pixel.ink))).toEqual(new Set(["amber", "ice"]));
    // Passing null is the opt-in; the flat silhouette stays the default, so a
    // caller that says nothing keeps the reflection it had before.
    expect(reflectCloud(mixed, { interlace: 1 }).every((pixel) => pixel.ink === "deep")).toBe(true);
  });

  it("drops punched holes and rejects bad options", () => {
    const withEye: PixelCloud = [...column(), { x: 1, y: -6, ink: "void" }];
    expect(reflectCloud(withEye, { interlace: 1 }).some((pixel) => pixel.x === 1)).toBe(false);
    expect(() => reflectCloud(column(), { squash: 0 })).toThrow(/squash/);
    expect(() => reflectCloud(column(), { interlace: 0 })).toThrow(/interlace/);
  });
});
