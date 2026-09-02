import { describe, expect, it } from "vitest";

import { INK_COLORS, type InkId, type PixelCloud } from "./ink";
import {
  BAYER_4X4,
  INK_RAMPS,
  cycleRamp,
  directionalLevel,
  ditherThreshold,
  rampInk,
  shadeCloud,
} from "./shading";

/** A diagonal strip, so a light from any angle has extent to normalise across. */
function strip(length: number, ink: InkId = "bone"): PixelCloud {
  return Array.from({ length }, (_unused, index) => ({ x: index, y: -index, ink }));
}

describe("the ramps", () => {
  it("only arrange inks that exist in the palette", () => {
    for (const [id, ramp] of Object.entries(INK_RAMPS)) {
      expect(ramp.length, `ramp '${id}' is too short to be a ramp`).toBeGreaterThanOrEqual(2);
      for (const ink of ramp) {
        expect(INK_COLORS, `ramp '${id}' names an ink that is not in the palette`).toHaveProperty(
          ink,
        );
      }
    }
  });

  it("never repeats an ink inside one ramp", () => {
    // A repeat is a dead step: two levels that render identically, which reads
    // as banding the author did not ask for.
    for (const [id, ramp] of Object.entries(INK_RAMPS)) {
      expect(new Set(ramp).size, `ramp '${id}' repeats an ink`).toBe(ramp.length);
    }
  });
});

describe("ditherThreshold", () => {
  it("is a 4x4 matrix of 16 distinct thresholds strictly inside 0..1", () => {
    const values = BAYER_4X4.flatMap((row) => [...row]);
    expect(BAYER_4X4).toHaveLength(4);
    expect(values).toHaveLength(16);
    expect(new Set(values).size).toBe(16);
    for (const value of values) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("has period 4 and wraps negative coordinates", () => {
    expect(ditherThreshold(6, 9)).toBe(ditherThreshold(2, 1));
    expect(ditherThreshold(-2, -3)).toBe(ditherThreshold(2, 1));
    expect(ditherThreshold(-4, -4)).toBe(ditherThreshold(0, 0));
  });
});

describe("rampInk", () => {
  const ramp: readonly InkId[] = ["deep", "steel", "ice", "bone"];

  it("maps the ends of the level range to the ends of the ramp", () => {
    expect(rampInk(ramp, 0)).toBe("deep");
    expect(rampInk(ramp, 1)).toBe("bone");
  });

  it("clamps levels outside 0..1 rather than reading off the ramp", () => {
    expect(rampInk(ramp, -5)).toBe("deep");
    expect(rampInk(ramp, 12)).toBe("bone");
    expect(rampInk(ramp, Number.NaN)).toBe("deep");
  });

  it("dithers only between the two steps that bracket the level", () => {
    // 0.5 of a four-step ramp sits exactly between 'steel' and 'ice'; whichever
    // way a given pixel's threshold falls, it must be one of those two.
    const picked = new Set(
      Array.from({ length: 16 }, (_unused, index) =>
        rampInk(ramp, 0.5, { x: index % 4, y: Math.floor(index / 4) }),
      ),
    );
    expect(picked).toEqual(new Set(["steel", "ice"]));
  });

  it("is flat when no dither position is given", () => {
    const picked = new Set(
      Array.from({ length: 16 }, () => rampInk(ramp, 0.5)),
    );
    expect(picked.size).toBe(1);
  });

  it("refuses an empty ramp", () => {
    expect(() => rampInk([], 0.5)).toThrow(/at least one ink/);
  });
});

describe("cycleRamp", () => {
  const ramp: readonly InkId[] = ["deep", "steel", "ice", "bone"];

  it("rotates, wraps, and accepts negative shifts", () => {
    expect(cycleRamp(ramp, 0)).toEqual(ramp);
    expect(cycleRamp(ramp, 1)).toEqual(["steel", "ice", "bone", "deep"]);
    expect(cycleRamp(ramp, 5)).toEqual(cycleRamp(ramp, 1));
    expect(cycleRamp(ramp, -1)).toEqual(["bone", "deep", "steel", "ice"]);
  });

  it("does not mutate the ramp it was given", () => {
    const original = [...ramp];
    cycleRamp(ramp, 3);
    expect(ramp).toEqual(original);
  });

  it("refuses an empty ramp", () => {
    expect(() => cycleRamp([], 1)).toThrow(/at least one ink/);
  });
});

describe("shadeCloud", () => {
  const ramp = INK_RAMPS.bone;

  it("returns an empty cloud for an empty cloud", () => {
    expect(shadeCloud([], { ramp })).toEqual([]);
  });

  it("keeps every pixel's position, count and order", () => {
    const cloud = strip(12);
    const shaded = shadeCloud(cloud, { ramp });
    expect(shaded).toHaveLength(cloud.length);
    shaded.forEach((pixel, index) => {
      expect({ x: pixel.x, y: pixel.y }).toEqual({ x: cloud[index]?.x, y: cloud[index]?.y });
    });
  });

  it("reaches both ends of the ramp across a lit body", () => {
    const shaded = shadeCloud(strip(24), { ramp, ambient: 0, light: { x: 1, y: -1 } });
    const inks = new Set(shaded.map((pixel) => pixel.ink));
    expect(inks).toContain(ramp[0]);
    expect(inks).toContain(ramp[ramp.length - 1]);
  });

  it("puts the highlight on the side the light comes from", () => {
    const cloud = strip(24);
    const lit = shadeCloud(cloud, { ramp, ambient: 0, dither: false, light: { x: 1, y: -1 } });
    const flipped = shadeCloud(cloud, { ramp, ambient: 0, dither: false, light: { x: -1, y: 1 } });
    // The first pixel of the strip is the far end from a light at +x/-y.
    expect(lit[0]?.ink).toBe(ramp[0]);
    expect(flipped[0]?.ink).toBe(ramp[ramp.length - 1]);
  });

  it("raises the shadow side with ambient without touching the highlight", () => {
    const cloud = strip(24);
    const dark = shadeCloud(cloud, { ramp, ambient: 0, dither: false });
    const ambient = shadeCloud(cloud, { ramp, ambient: 1, dither: false });
    expect(new Set(dark.map((pixel) => pixel.ink)).size).toBeGreaterThan(1);
    expect(new Set(ambient.map((pixel) => pixel.ink))).toEqual(
      new Set([ramp[ramp.length - 1] as InkId]),
    );
  });

  it("bands into ramp steps with dither off, and only ever uses ramp inks", () => {
    const shaded = shadeCloud(strip(40), { ramp, dither: false });
    const inks = new Set(shaded.map((pixel) => pixel.ink));
    expect(inks.size).toBeLessThanOrEqual(ramp.length);
    for (const ink of inks) {
      expect(ramp).toContain(ink);
    }
  });

  it("leaves inks outside `only` exactly as they were", () => {
    const cloud: PixelCloud = [
      { x: 0, y: 0, ink: "bone" },
      { x: 1, y: -1, ink: "void" },
      { x: 2, y: -2, ink: "magenta" },
      { x: 3, y: -3, ink: "bone" },
    ];
    const shaded = shadeCloud(cloud, { ramp, only: ["bone"] });
    expect(shaded[1]?.ink).toBe("void");
    expect(shaded[2]?.ink).toBe("magenta");
    expect(ramp).toContain(shaded[0]?.ink as InkId);
  });

  it("shades a cloud with no extent flat instead of dividing by zero", () => {
    const shaded = shadeCloud([{ x: 4, y: -4, ink: "bone" }], { ramp, ambient: 0 });
    expect(shaded[0]?.ink).toBe(ramp[ramp.length - 1]);
  });

  it("honours a custom level field", () => {
    const shaded = shadeCloud(strip(8), { ramp, ambient: 0, dither: false, levelAt: () => 0 });
    expect(new Set(shaded.map((pixel) => pixel.ink))).toEqual(new Set([ramp[0] as InkId]));
  });

  it("is deterministic — the same cloud shades to the same pixels", () => {
    const cloud = strip(24);
    expect(shadeCloud(cloud, { ramp })).toEqual(shadeCloud(cloud, { ramp }));
  });
});

describe("directionalLevel", () => {
  const bounds = { left: 0, top: -8, right: 8, bottom: 0 };

  it("spans 0..1 across the bounds and inverts with the light", () => {
    const level = directionalLevel({ x: 1, y: 0 }, bounds);
    expect(level({ x: 0, y: 0, ink: "bone" })).toBeCloseTo(0);
    expect(level({ x: 8, y: 0, ink: "bone" })).toBeCloseTo(1);

    const opposite = directionalLevel({ x: -1, y: 0 }, bounds);
    expect(opposite({ x: 0, y: 0, ink: "bone" })).toBeCloseTo(1);
  });

  it("treats a zero-length light as fully lit rather than as NaN", () => {
    const level = directionalLevel({ x: 0, y: 0 }, bounds);
    expect(level({ x: 3, y: -3, ink: "bone" })).toBe(1);
  });
});
