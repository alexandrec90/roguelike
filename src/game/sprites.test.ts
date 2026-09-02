import { describe, expect, it } from "vitest";

import { rasterizeSprite } from "./pixel-art";
import { ALL_SPRITES, RAIN_STREAK, SLIME_FRAMES, TORCH_FRAMES } from "./sprites";
import { RAIN_SLANT } from "./weather";

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

  it("keeps the rain streak one logical pixel thick per row", () => {
    const lit = RAIN_STREAK.rows.map((row) => [...row].filter((glyph) => glyph !== ".").length);
    expect(lit.every((count) => count === 1)).toBe(true);
    expect(RAIN_STREAK.rows.length).toBeGreaterThan(1);
  });

  it("leans the rain streak by exactly the wind the drops fall on", () => {
    const columns = RAIN_STREAK.rows.map((row) => [...row].findIndex((glyph) => glyph !== "."));
    const first = columns[0];
    const last = columns[columns.length - 1];
    expect(first).toBe(0);
    expect(last).toBeGreaterThan(0);
    // Slope over the drawn run, in columns per row — the same number the
    // emitter pushes the drop by, or the trail points where it has not been.
    const slope = ((last as number) - (first as number)) / (columns.length - 1);
    expect(slope).toBeCloseTo(RAIN_SLANT, 5);
  });

  it("puts the bright head at the leading end of the streak", () => {
    const rows = RAIN_STREAK.rows;
    const head = rows[rows.length - 1] as string;
    expect(head).toContain("R");
    expect(rows.slice(0, -1).join("")).not.toContain("R");
  });
});
