import { describe, expect, it } from "vitest";

import { cloudBounds } from "../ink";
import { INK_RAMPS } from "../shading";
import {
  lobeMound,
  lobeRing,
  scaleBox,
  volumeBox,
  volumeCloud,
  volumeCost,
  volumeField,
  type VolumeSpec,
} from "./volume";

const BALL: VolumeSpec = { lobes: [{ x: 0, y: 0, radius: 6 }], weld: 1 };
const PAIR: VolumeSpec = {
  lobes: [
    { x: -4, y: 0, radius: 5 },
    { x: 4, y: 0, radius: 5 },
  ],
  weld: 2,
};
const LIT = { ramp: INK_RAMPS.canopy, light: { x: -1, y: -0.5 } };

describe("the volume field", () => {
  it("is negative inside a lobe and positive outside", () => {
    const field = volumeField(BALL);
    expect(field(0, 0)).toBeLessThan(0);
    expect(field(20, 0)).toBeGreaterThan(0);
  });

  it("welds two lobes into one mass rather than leaving a waist", () => {
    const welded = volumeField(PAIR);
    const separate = volumeField({ ...PAIR, weld: 0 });
    expect(welded(0, 0)).toBeLessThan(separate(0, 0));
  });

  it("displaces the surface when a warp is given, and not otherwise", () => {
    const still = volumeField(BALL);
    const warped = volumeField({
      ...BALL,
      warp: { amplitudeX: 4, amplitudeY: 4, scale: 3, seed: 7, drift: 0 },
    });
    let differences = 0;
    for (let x = -8; x <= 8; x += 1) {
      if (Math.abs(still(x, 0) - warped(x, 0)) > 0.2) {
        differences += 1;
      }
    }
    expect(differences).toBeGreaterThan(4);
  });

  it("breathes: advancing the warp's drift changes the surface", () => {
    const at = (drift: number): number =>
      volumeField({ ...BALL, warp: { amplitudeX: 4, amplitudeY: 4, scale: 3, seed: 7, drift } })(5, 0);
    expect(at(0)).not.toBeCloseTo(at(3), 3);
  });
});

describe("the volume box", () => {
  it("covers the lobes plus the warp's reach and the weld", () => {
    const box = volumeBox({ ...BALL, warp: { amplitudeX: 4, amplitudeY: 2, scale: 3, seed: 1, drift: 0 } });
    expect(box.left).toBeLessThanOrEqual(-11);
    expect(box.right).toBeGreaterThanOrEqual(11);
  });

  it("is integral, so the raster loop walks whole pixels", () => {
    const box = volumeBox(PAIR);
    for (const edge of [box.left, box.top, box.right, box.bottom]) {
      expect(Number.isInteger(edge)).toBe(true);
    }
  });
});

describe("rendering a volume", () => {
  it("draws a filled body from the ramp it was given", () => {
    const cloud = volumeCloud(BALL, LIT);
    expect(cloud.length).toBeGreaterThan(80);
    expect(cloud.every((pixel) => INK_RAMPS.canopy.includes(pixel.ink))).toBe(true);
  });

  it("returns nothing for a body with no lobes rather than throwing", () => {
    expect(volumeCloud({ lobes: [], weld: 1 }, LIT)).toEqual([]);
  });

  it("clips to the ground when asked", () => {
    const cloud = volumeCloud(BALL, LIT, { bottom: 0 });
    expect(cloud.every((pixel) => pixel.y <= 0)).toBe(true);
  });

  it("lights the side facing the light and darkens the far side", () => {
    const ramp = INK_RAMPS.bone;
    const cloud = volumeCloud(BALL, { ramp, light: { x: -1, y: 0 }, ambient: 0, occlusion: 0, dither: false });
    const level = (x: number): number =>
      ramp.indexOf(cloud.find((pixel) => pixel.x === x && pixel.y === 0)?.ink ?? "void");
    expect(level(-5)).toBeGreaterThan(level(5));
  });

  it("re-lights correctly when the light moves, rather than sliding a highlight", () => {
    const ramp = INK_RAMPS.bone;
    const brightestX = (lx: number): number => {
      const cloud = volumeCloud(BALL, { ramp, light: { x: lx, y: 0 }, ambient: 0, occlusion: 0, dither: false });
      return cloud.reduce(
        (best, pixel) => (ramp.indexOf(pixel.ink) > ramp.indexOf(best.ink) ? pixel : best),
        cloud[0] ?? { x: 0, y: 0, ink: "void" as const },
      ).x;
    };
    expect(brightestX(-1)).toBeLessThan(0);
    expect(brightestX(1)).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const draw = (): string => JSON.stringify(volumeCloud(PAIR, LIT));
    expect(draw()).toBe(draw());
  });
});

describe("the cost model", () => {
  it("predicts an upper bound the meter actually lands under", () => {
    const meter = { evaluations: 0 };
    volumeCloud(PAIR, { ...LIT, meter });
    expect(meter.evaluations).toBeGreaterThan(0);
    expect(meter.evaluations).toBeLessThanOrEqual(volumeCost(PAIR, LIT));
  });

  it("counts a flat render as a fifth of a lit one", () => {
    expect(volumeCost(PAIR, { ...LIT, flat: true }) * 5).toBe(volumeCost(PAIR, LIT));
  });

  it("measures the saving a flat render really makes", () => {
    const lit = { evaluations: 0 };
    const flat = { evaluations: 0 };
    volumeCloud(PAIR, { ...LIT, meter: lit });
    volumeCloud(PAIR, { ...LIT, flat: true, meter: flat });
    expect(flat.evaluations * 2).toBeLessThan(lit.evaluations);
  });
});

describe("lobe arrangements", () => {
  it("rings lobes around the centre it was given", () => {
    const lobes = lobeRing(6, { x: 0, y: -10, radiusX: 8, radiusY: 5 }, { min: 3, max: 5 }, 9);
    expect(lobes).toHaveLength(6);
    for (const lobe of lobes) {
      expect(Math.abs(lobe.x)).toBeLessThanOrEqual(8);
      expect(Math.abs(lobe.y + 10)).toBeLessThanOrEqual(5);
      expect(lobe.radius).toBeGreaterThanOrEqual(3);
      expect(lobe.radius).toBeLessThanOrEqual(5);
    }
  });

  it("makes a different ring for a different seed", () => {
    const shape = (seed: number): string =>
      JSON.stringify(lobeRing(5, { x: 0, y: 0, radiusX: 6, radiusY: 4 }, { min: 2, max: 4 }, seed));
    expect(shape(1)).not.toBe(shape(2));
  });

  it("mounds lobes largest in the middle, so a rock is not a bunch of grapes", () => {
    const lobes = lobeMound(5, 20, 12, 3);
    const middle = lobes[2]?.radius ?? 0;
    expect(middle).toBeGreaterThan(lobes[0]?.radius ?? 0);
    expect(middle).toBeGreaterThan(lobes[4]?.radius ?? 0);
  });

  it("handles a single-lobe mound without dividing by zero", () => {
    const lobes = lobeMound(1, 10, 8, 1);
    expect(lobes).toHaveLength(1);
    expect(Number.isFinite(lobes[0]?.x ?? Number.NaN)).toBe(true);
  });
});

describe("rendering a volume at a scale", () => {
  const span = (cloud: ReturnType<typeof volumeCloud>): { width: number; height: number } => {
    const bounds = cloudBounds(cloud);
    if (bounds === null) {
      throw new Error("empty cloud");
    }
    return { width: bounds.right - bounds.left + 1, height: bounds.bottom - bounds.top + 1 };
  };

  it("is the ordinary render at scale 1", () => {
    expect(volumeCloud(BALL, LIT, undefined, 1)).toEqual(volumeCloud(BALL, LIT));
  });

  it("samples the same field at a wider spacing, so the body shrinks with it", () => {
    const full = span(volumeCloud(PAIR, LIT));
    const half = span(volumeCloud(PAIR, LIT, undefined, 0.5));

    expect(half.width).toBeLessThan(full.width);
    expect(half.width).toBeGreaterThanOrEqual(Math.floor(full.width / 2) - 1);
    expect(half.width).toBeLessThanOrEqual(Math.ceil(full.width / 2) + 1);
    expect(half.height).toBeLessThanOrEqual(Math.ceil(full.height / 2) + 1);
  });

  it("keeps the clip in cloud units, so a ground line still cuts at the foot", () => {
    const clipped = volumeCloud(BALL, LIT, { bottom: 0 }, 0.5);
    expect(clipped.length).toBeGreaterThan(0);
    for (const pixel of clipped) {
      expect(pixel.y).toBeLessThanOrEqual(0);
    }
  });

  it("rounds a box outward rather than clipping a pixel off the edge", () => {
    expect(scaleBox({ left: -7, top: -9, right: 7, bottom: 3 }, 0.5)).toEqual({
      left: -4,
      top: -5,
      right: 4,
      bottom: 2,
    });
  });

  it("keeps flat lighting in cloud space when the scaled box rounds outward", () => {
    const light = { ...LIT, flat: true, dither: false };
    const full = volumeCloud(PAIR, light);
    const reference = new Map(full.map((p) => [`${p.x},${p.y}`, p.ink]));
    const half = volumeCloud(PAIR, light, undefined, 0.5);
    expect(half.length).toBeGreaterThan(0);
    for (const pixel of half) {
      expect(pixel.ink).toBe(reference.get(`${pixel.x * 2},${pixel.y * 2}`));
    }
  });

  it("does not draw outside a clip that rounds to a partial screen pixel", () => {
    const clipped = volumeCloud(BALL, LIT, { bottom: -3 }, 0.5);
    expect(clipped.length).toBeGreaterThan(0);
    expect(clipped.every((pixel) => pixel.y / 0.5 <= -3)).toBe(true);
  });

  it("refuses a scale that is not positive", () => {
    expect(() => volumeCloud(BALL, LIT, undefined, 0)).toThrow(/positive/);
    expect(() => volumeCloud(BALL, LIT, undefined, -1)).toThrow(/positive/);
  });
});
