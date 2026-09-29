import { describe, expect, it } from "vitest";

import { INK_RAMPS } from "../shading";
import { rasterizePrims, type ScreenPrim } from "./volume-raster";

function sphere(x: number, y: number, radius: number, depth: number, material: ScreenPrim["material"], group = 0): ScreenPrim {
  return { ax: x, ay: y, bx: x, by: y, ra: radius, rb: radius, da: depth, db: depth, material, shade: 0, group };
}

const LIGHT = { x: -0.6, y: -0.8, ambient: 0.2 };

describe("rasterizePrims", () => {
  it("draws nothing for no bodies", () => {
    expect(rasterizePrims([], LIGHT).cloud).toEqual([]);
  });

  it("fills a sphere, and rings it in the darkest step of its own material", () => {
    const raster = rasterizePrims([sphere(0, -5, 3, 0, "tunic")], LIGHT);
    const dark = INK_RAMPS.tunic[0];
    expect(raster.materialAt(0, -5)).toBe("tunic");
    // The outline sits just outside the radius and is not a filled pixel.
    expect(raster.materialAt(0, -9)).toBeUndefined();
    expect(raster.cloud.some((p) => p.x === 0 && p.y === -9 && p.ink === dark)).toBe(true);
    expect(raster.cloud.some((p) => p.x === 0 && p.y === -10)).toBe(false);
  });

  it("lights the side facing the lamp brighter than the far side", () => {
    const ramp = INK_RAMPS.tunic;
    const raster = rasterizePrims([sphere(0, -6, 4, 0, "tunic")], LIGHT);
    const at = (x: number, y: number) => ramp.indexOf(raster.cloud.find((p) => p.x === x && p.y === y)?.ink ?? ramp[0]!);
    expect(at(-2, -8)).toBeGreaterThan(at(2, -4));
  });

  it("keeps the nearer surface where two bodies overlap, whatever the order", () => {
    const near = sphere(0, -5, 2, 5, "skin", 1);
    const far = sphere(1, -5, 2, -5, "leather", 2);
    expect(rasterizePrims([near, far], LIGHT).materialAt(0, -5)).toBe("skin");
    expect(rasterizePrims([far, near], LIGHT).materialAt(0, -5)).toBe("skin");
  });

  it("never draws below the ground line", () => {
    const raster = rasterizePrims([sphere(0, 0, 3, 0, "leather")], LIGHT);
    expect(raster.cloud.every((p) => p.y <= 0)).toBe(true);
  });

  it("re-inks a filled pixel in place, and refuses an empty one", () => {
    const raster = rasterizePrims([sphere(0, -5, 3, 0, "skin")], LIGHT);
    const before = raster.cloud.length;
    expect(raster.setInk(0, -5, "hair-0")).toBe(true);
    expect(raster.cloud.find((p) => p.x === 0 && p.y === -5)?.ink).toBe("hair-0");
    expect(raster.cloud.length).toBe(before);
    expect(raster.setInk(40, 40, "hair-0")).toBe(false);
  });

  it("glows from noise rather than the sun when a body is emissive", () => {
    const glowing: ScreenPrim = { ...sphere(0, -6, 3, 0, "fire"), emissive: { timeMs: 100, seed: 3 } };
    const lit = rasterizePrims([glowing], { x: 0, y: 1, ambient: 0 });
    const fill = lit.cloud.filter((p) => lit.materialAt(p.x, p.y) === "fire");
    // Lit from *below* with no ambient, a plain body would be mostly its darkest steps.
    const bright = fill.filter((p) => INK_RAMPS.fire.indexOf(p.ink) >= 3).length;
    expect(bright / fill.length).toBeGreaterThan(0.5);
  });

  it("is deterministic", () => {
    const prims = [sphere(0, -5, 3, 0, "tunic"), sphere(2, -3, 2, 1, "skin", 1)];
    expect(rasterizePrims(prims, LIGHT).cloud).toEqual(rasterizePrims(prims, LIGHT).cloud);
  });
});
