import { describe, expect, it } from "vitest";

import { AUTHORED, type AssetEntry } from "../asset-types";
import { cloudToSprite, inkHex, INK_TOKENS } from "../ink";
import { validateRegistry } from "../registry-validation";
import { FIRE_ASSETS, inkSwap } from "./fire";

describe("the fire lab entries", () => {
  it("are structurally valid", () => {
    expect(validateRegistry(FIRE_ASSETS)).toEqual([]);
  });

  it.each(FIRE_ASSETS.map((entry): [string, AssetEntry] => [entry.id, entry]))(
    "%s has a palette swap that actually swaps something",
    (_id, entry) => {
      const swaps = entry.variants.filter((variant) => variant.id !== AUTHORED.id);
      expect(swaps.length).toBeGreaterThan(0);
      expect(swaps.every((variant) => Object.keys(variant.overrides).length > 0)).toBe(true);
    },
  );

  it("covers the flame, the campfire, the fireball, the burst, the nova and the decals", () => {
    const ids = FIRE_ASSETS.map((entry) => entry.id);
    for (const id of ["fire-flame", "fire-campfire", "fire-fireball", "fire-explosion", "frost-nova", "decal-scorch"]) {
      expect(ids).toContain(id);
    }
  });
});

describe("inkSwap", () => {
  it("keeps only tokens every frame uses, and spells the target ink", () => {
    const frame = { width: 2, height: 1, originX: 0, originY: 0 };
    const sprites = [
      cloudToSprite([{ x: 0, y: 0, ink: "fire-3" }, { x: 1, y: 0, ink: "fire-6" }], frame),
      cloudToSprite([{ x: 0, y: 0, ink: "fire-3" }], frame),
    ];
    const swap = inkSwap("x", "X", sprites, { "fire-3": "arcane-2", "fire-6": "arcane-4" });
    expect(swap.overrides).toEqual({ [INK_TOKENS["fire-3"]]: inkHex("arcane-2") });
  });
});
