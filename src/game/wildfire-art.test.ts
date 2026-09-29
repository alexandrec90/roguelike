import { describe, expect, it } from "vitest";

import { cloudBounds } from "./ink";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import { grassFlameCloud, scorchCloud } from "./wildfire-art";

describe("a grass fire", () => {
  it("is nothing when it is not burning", () => {
    expect(grassFlameCloud(7, 1000, 0)).toEqual([]);
  });

  it("stands up from the cell in fire inks, taller the harder it burns", () => {
    const hot = grassFlameCloud(7, 1000, 1);
    const low = grassFlameCloud(7, 1000, 0.3);
    expect(hot.length).toBeGreaterThan(low.length);
    expect(hot.every((pixel) => pixel.ink.startsWith("fire-"))).toBe(true);
    const bounds = cloudBounds(hot)!;
    expect(bounds.bottom).toBeLessThanOrEqual(0);
    expect(bounds.top).toBeLessThan(-4);
    expect(Math.abs(bounds.left)).toBeLessThanOrEqual(TILE_WIDTH / 2 + 2);
  });

  it("flickers over time and reproduces for a time", () => {
    expect(grassFlameCloud(7, 1000, 1)).toEqual(grassFlameCloud(7, 1000, 1));
    expect(grassFlameCloud(7, 1000, 1)).not.toEqual(grassFlameCloud(7, 1400, 1));
  });
});

describe("a scorch", () => {
  it("chars the tile when fresh, stays inside it, and fades as grass returns", () => {
    const fresh = scorchCloud(3, 1, 0, 0);
    const old = scorchCloud(3, 0.3, 0, 0);
    expect(fresh.length).toBeGreaterThan(TILE_WIDTH * TILE_DEPTH * 0.5);
    expect(old.length).toBeLessThan(fresh.length);
    for (const pixel of fresh) {
      expect(pixel.x >= 0 && pixel.x < TILE_WIDTH && pixel.y >= 0 && pixel.y < TILE_DEPTH).toBe(true);
    }
    expect(scorchCloud(3, 0, 0, 0)).toEqual([]);
  });

  it("glows with embers only while hot", () => {
    const embers = (cloud: ReturnType<typeof scorchCloud>) => cloud.filter((pixel) => pixel.ink.startsWith("fire-")).length;
    expect(embers(scorchCloud(3, 1, 1, 0))).toBeGreaterThan(0);
    expect(embers(scorchCloud(3, 1, 0, 0))).toBe(0);
  });
});
