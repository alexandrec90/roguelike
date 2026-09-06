import { describe, expect, it } from "vitest";

import { INK_RAMPS } from "../shading";
import {
  fieldNormal,
  rasterizeSdf,
  sdCapsule,
  sdCircle,
  sdEllipse,
  sdSmoothUnion,
  sdSubtract,
  sdUnion,
  warpField,
} from "./sdf";

const BOX = { left: -12, top: -12, right: 12, bottom: 12 };

describe("distance primitives", () => {
  it("puts a circle's surface at zero and its centre at minus the radius", () => {
    const field = sdCircle(0, 0, 5);
    expect(field(0, 0)).toBe(-5);
    expect(field(5, 0)).toBe(0);
    expect(field(0, 9)).toBe(4);
  });

  it("agrees with a circle when an ellipse's radii are equal", () => {
    const round = sdEllipse(1, 2, 4, 4);
    expect(round(1, 2)).toBeCloseTo(-4, 6);
    expect(round(5, 2)).toBeCloseTo(0, 6);
  });

  it("measures a capsule from the segment, not from either end", () => {
    const field = sdCapsule(-4, 0, 4, 0, 2);
    expect(field(0, 0)).toBe(-2);
    expect(field(0, 2)).toBe(0);
    expect(field(-8, 0)).toBe(2);
  });

  it("collapses a zero-length capsule to a circle rather than dividing by zero", () => {
    expect(sdCapsule(0, 0, 0, 0, 3)(0, 4)).toBe(1);
  });
});

describe("combinators", () => {
  it("unions by taking the nearest surface", () => {
    const field = sdUnion(sdCircle(-4, 0, 3), sdCircle(4, 0, 3));
    expect(field(-4, 0)).toBe(-3);
    expect(field(4, 0)).toBe(-3);
    expect(field(0, 0)).toBe(1);
  });

  it("fills the seam a hard union would leave between two touching lobes", () => {
    const hard = sdUnion(sdCircle(-3, 0, 3), sdCircle(3, 0, 3));
    const soft = sdSmoothUnion(2, sdCircle(-3, 0, 3), sdCircle(3, 0, 3));
    expect(soft(0, 0)).toBeLessThan(hard(0, 0));
  });

  it("degrades to a hard union at k <= 0", () => {
    const shapes = [sdCircle(-2, 0, 2), sdCircle(2, 0, 2)] as const;
    expect(sdSmoothUnion(0, ...shapes)(0, 0)).toBe(sdUnion(...shapes)(0, 0));
  });

  it("subtracts one field from another", () => {
    const ring = sdSubtract(sdCircle(0, 0, 6), sdCircle(0, 0, 3));
    expect(ring(0, 0)).toBeGreaterThan(0);
    expect(ring(4.5, 0)).toBeLessThan(0);
  });

  it("warps by sampling somewhere else", () => {
    const shifted = warpField(sdCircle(0, 0, 4), () => ({ x: 5, y: 0 }));
    expect(shifted(5, 0)).toBe(-4);
  });
});

describe("normals and rasterisation", () => {
  it("points a normal outward from the surface", () => {
    const normal = fieldNormal(sdCircle(0, 0, 5), 5, 0);
    expect(normal.x).toBeGreaterThan(0.9);
    expect(Math.abs(normal.y)).toBeLessThan(0.1);
  });

  it("returns a zero normal on a flat field instead of dividing by zero", () => {
    expect(fieldNormal(() => -1, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("keeps only the pixels inside the shape", () => {
    const cloud = rasterizeSdf(sdCircle(0, 0, 4), { box: BOX, ramp: INK_RAMPS.verdant });
    expect(cloud.length).toBeGreaterThan(30);
    expect(cloud.every((pixel) => Math.hypot(pixel.x, pixel.y) <= 4.001)).toBe(true);
  });

  it("lights the side facing the light more brightly than the far side", () => {
    const ramp = INK_RAMPS.bone;
    const cloud = rasterizeSdf(sdCircle(0, 0, 6), {
      box: BOX,
      ramp,
      light: { x: -1, y: 0 },
      ambient: 0,
      occlusion: 0,
      dither: false,
    });
    const lit = cloud.find((pixel) => pixel.x === -6 && pixel.y === 0);
    const dark = cloud.find((pixel) => pixel.x === 6 && pixel.y === 0);
    expect(ramp.indexOf(lit?.ink ?? "void")).toBeGreaterThan(ramp.indexOf(dark?.ink ?? "void"));
  });

  it("darkens the interior when occlusion is on", () => {
    const ramp = INK_RAMPS.verdant;
    const inkAt = (occlusion: number): number => {
      const cloud = rasterizeSdf(sdCircle(0, 0, 8), { box: BOX, ramp, occlusion, dither: false });
      return ramp.indexOf(cloud.find((pixel) => pixel.x === 0 && pixel.y === 0)?.ink ?? "void");
    };
    expect(inkAt(0.2)).toBeLessThan(inkAt(0));
  });

  it("honours a mask that rejects a pixel", () => {
    const cloud = rasterizeSdf(sdCircle(0, 0, 4), {
      box: BOX,
      ramp: INK_RAMPS.bone,
      mask: (x) => x >= 0,
    });
    expect(cloud.every((pixel) => pixel.x >= 0)).toBe(true);
  });

  it("is deterministic", () => {
    const draw = (): string =>
      JSON.stringify(rasterizeSdf(sdEllipse(0, 0, 7, 4), { box: BOX, ramp: INK_RAMPS.tide }));
    expect(draw()).toBe(draw());
  });
});
