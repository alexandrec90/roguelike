import { describe, expect, it } from "vitest";

import { INK_COLORS } from "../ink";
import { elementalFactor, glowColor, SLIME_INKS, SLIME_VARIANTS } from "./slime-palette";

describe("slime inks", () => {
  it("name only inks that exist, with a five-step body ramp", () => {
    for (const variant of SLIME_VARIANTS) {
      const inks = SLIME_INKS[variant];
      expect(inks.ramp).toHaveLength(5);
      const all = [...inks.ramp, ...inks.flash, ...inks.goo, inks.outline, inks.rimLit, inks.core, inks.bounce, inks.glint, inks.sheen];
      for (const ink of all) {
        expect(INK_COLORS[ink]).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("glow only for the fiery and the arcane, in a palette colour", () => {
    expect(glowColor("green")).toBeNull();
    expect(glowColor("frost")).toBeNull();
    expect(glowColor("fire")).toBe(INK_COLORS["fire-4"]);
    expect(glowColor("arcane")).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("elemental damage", () => {
  it("is plain for steel and for a green slime", () => {
    expect(elementalFactor("fire", "steel")).toBe(1);
    expect(elementalFactor("green", "fire")).toBe(1);
    expect(elementalFactor("green", "frost")).toBe(1);
  });

  it("is nothing against a slime's own element and double against its opposite", () => {
    expect(elementalFactor("fire", "fire")).toBe(0);
    expect(elementalFactor("frost", "frost")).toBe(0);
    expect(elementalFactor("fire", "frost")).toBe(2);
    expect(elementalFactor("frost", "fire")).toBe(2);
  });
});
