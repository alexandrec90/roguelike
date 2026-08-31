import { describe, expect, it } from "vitest";

import { rasterizeSprite } from "./pixel-art";
import { ALL_TILES, FLOOR_STONE, TILE_SIZE, WALL_FACE, WALL_TOP } from "./tiles";

describe("terrain tiles", () => {
  it("are all square on the world grid", () => {
    for (const tile of ALL_TILES) {
      expect(tile.rows).toHaveLength(TILE_SIZE);
      for (const row of tile.rows) {
        expect(row).toHaveLength(TILE_SIZE);
      }
    }
  });

  it("rasterize without unknown tokens", () => {
    for (const tile of ALL_TILES) {
      expect(() => rasterizeSprite(tile)).not.toThrow();
    }
  });

  it("are fully opaque, so no floor shows through a wall", () => {
    for (const tile of ALL_TILES) {
      const raster = rasterizeSprite(tile);
      const alphas = new Set<number>();
      for (let index = 3; index < raster.rgba.length; index += 4) {
        alphas.add(raster.rgba[index] ?? 0);
      }
      expect([...alphas]).toEqual([255]);
    }
  });

  it("keep the seam on one edge only, so a tiled field has single mortar lines", () => {
    for (const tile of [FLOOR_STONE, WALL_TOP]) {
      expect(tile.rows[0]).not.toBe(tile.rows[TILE_SIZE - 1]);
    }
  });

  it("stacks the wall face vertically without banding", () => {
    // Anything that spans a whole row repeats every 16px once faces are stacked.
    // Two mortar courses are meant to; a contact shadow is not — it belongs at
    // the foot of the wall, which is one place, not every sixteenth pixel.
    const solidRows = WALL_FACE.rows.filter((row) => new Set(row).size === 1);

    expect(solidRows).toEqual(["m".repeat(TILE_SIZE), "m".repeat(TILE_SIZE)]);
    expect(WALL_FACE.rows[TILE_SIZE - 1]).not.toBe(WALL_FACE.rows[0]);
  });

  it("darkens the back edge of the wall cap", () => {
    expect(WALL_TOP.rows[0]).toBe("e".repeat(TILE_SIZE));
  });
});
