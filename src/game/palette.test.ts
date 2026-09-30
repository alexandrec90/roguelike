import { describe, expect, it } from "vitest";

import { hexToRgb } from "./color";
import { INK_ALPHA, INK_COLORS, INK_TOKENS, type InkId } from "./ink";
import {
  familyHex,
  familyInks,
  familyRamp,
  INK_FAMILIES,
  rampSlice,
  type Family,
} from "./palette";
import { INK_RAMPS } from "./shading";

function luma(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.3 * r + 0.59 * g + 0.11 * b;
}

describe("the material families", () => {
  it("name every step `family-index` and resolve each to its hex", () => {
    for (const family of Object.keys(INK_FAMILIES) as Family[]) {
      familyRamp(family).forEach((ink, index) => {
        expect(ink).toBe(`${family}-${index}`);
        expect(INK_COLORS[ink]).toBe(INK_FAMILIES[family][index]);
        expect(familyHex(ink)).toBe(INK_FAMILIES[family][index]);
      });
    }
  });

  it("run darkest first, so a level walks a ramp from shadow to highlight", () => {
    for (const family of Object.keys(INK_FAMILIES) as Family[]) {
      if (family === "petal") {
        continue; // accents, not a ramp
      }
      const hexes = INK_FAMILIES[family];
      for (let index = 1; index < hexes.length; index += 1) {
        expect(luma(hexes[index] as string), `${family}-${index}`).toBeGreaterThan(
          luma(hexes[index - 1] as string),
        );
      }
    }
  });

  it("are all in the ink table, with tokens and opacities", () => {
    for (const ink of familyInks()) {
      expect(INK_TOKENS[ink]).toHaveLength(1);
      expect(INK_ALPHA[ink]).toBeGreaterThan(0);
    }
  });

  it("keep the sheer materials sheer and the rest opaque", () => {
    expect(INK_ALPHA["smoke-2"]).toBeLessThan(1);
    expect(INK_ALPHA["slime-2"]).toBeLessThan(1);
    expect(INK_ALPHA.shadow).toBeLessThan(0.6);
    expect(INK_ALPHA["grass-3"]).toBe(1);
    expect(INK_ALPHA["fire-6"]).toBe(1);
  });

  it("slices a ramp inclusively", () => {
    expect(rampSlice("fire", 2, 4)).toEqual(["fire-2", "fire-3", "fire-4"]);
  });

  it("refuses an ink that is not in its family", () => {
    expect(() => familyHex("grass-9" as never)).toThrow(/No ink/);
  });

  it("gives every family but the accents a ramp of its own", () => {
    expect(INK_RAMPS.fire).toEqual(familyRamp("fire"));
    expect(INK_RAMPS.canopy).toEqual(familyRamp("leaf"));
    expect(Object.keys(INK_RAMPS)).not.toContain("petal");
  });

  it("keeps the legacy inks' tokens stable", () => {
    const legacy: readonly InkId[] = ["bone", "cyan", "void", "water"];
    expect(legacy.map((ink) => INK_TOKENS[ink])).toEqual(["w", "c", "k", "b"]);
  });
});
