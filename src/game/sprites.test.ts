import { describe, expect, it } from "vitest";

import { rasterizeSprite } from "./pixel-art";
import { ALL_SPRITES, RAIN_STREAK, SLIME_FRAMES, TORCH_FRAMES } from "./sprites";

describe("pixel sprite catalog", () => {
  it("contains only valid, rasterizable sources", () => {
    for (const sprite of ALL_SPRITES) {
      expect(() => rasterizeSprite(sprite)).not.toThrow();
    }
  });

  it("keeps animation frames on stable canvases", () => {
    const dimensions = (sprites: typeof SLIME_FRAMES) =>
      sprites.map((sprite) => [sprite.rows[0]?.length, sprite.rows.length]);

    expect(new Set(dimensions(SLIME_FRAMES).map(String)).size).toBe(1);
    expect(new Set(dimensions(TORCH_FRAMES).map(String)).size).toBe(1);
  });

  it("keeps the rain streak one logical pixel wide", () => {
    expect(RAIN_STREAK.rows.every((row) => row.length === 1)).toBe(true);
    expect(RAIN_STREAK.rows.length).toBeGreaterThan(1);
  });
});
