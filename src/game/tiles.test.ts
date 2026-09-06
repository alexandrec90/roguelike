import { describe, expect, it } from "vitest";

import { rasterizeSprite, type PixelSpriteSource } from "./pixel-art";
import { TILE_DEPTH, TILE_WIDTH, WALL_RISE } from "./projection";
import {
  ALL_TILES,
  DIRT_PATH,
  GRASS,
  GROUND_TILES,
  STANDING_TILES,
  TERRAIN_PALETTE,
  WALL_FACE,
  WALL_SHELF,
  WALL_TOP,
} from "./tiles";

/** Total light each scanline of a tile emits, top row first. */
function rowLight(tile: PixelSpriteSource): number[] {
  const raster = rasterizeSprite(tile);
  return Array.from({ length: raster.height }, (_unused, y) => {
    let sum = 0;
    for (let x = 0; x < raster.width; x += 1) {
      const at = (y * raster.width + x) * 4;
      sum += (raster.rgba[at] ?? 0) + (raster.rgba[at + 1] ?? 0) + (raster.rgba[at + 2] ?? 0);
    }
    return sum;
  });
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

describe("terrain tiles", () => {
  it("authors ground art already foreshortened, so nothing is scaled at draw time", () => {
    for (const tile of GROUND_TILES) {
      expect(tile.rows).toHaveLength(TILE_DEPTH);
      for (const row of tile.rows) {
        expect(row).toHaveLength(TILE_WIDTH);
      }
    }
  });

  it("draws standing art at full height, because a face is not foreshortened", () => {
    for (const tile of STANDING_TILES) {
      expect(tile.rows).toHaveLength(WALL_RISE);
      for (const row of tile.rows) {
        expect(row).toHaveLength(TILE_WIDTH);
      }
    }
  });

  it("rasterize without unknown tokens", () => {
    for (const tile of ALL_TILES) {
      expect(() => rasterizeSprite(tile)).not.toThrow();
    }
  });

  it("are fully opaque, so no ground shows through a wall", () => {
    for (const tile of ALL_TILES) {
      const raster = rasterizeSprite(tile);
      const alphas = new Set<number>();
      for (let index = 3; index < raster.rgba.length; index += 4) {
        alphas.add(raster.rgba[index] ?? 0);
      }
      expect([...alphas]).toEqual([255]);
    }
  });

  it("share one palette, which is what lets a field compose into one texture", () => {
    for (const tile of ALL_TILES) {
      expect(tile.palette).toBe(TERRAIN_PALETTE);
    }
  });

  it("keeps every material's tokens to itself, so a swap cannot bleed", () => {
    const tokensOf = (tile: { readonly rows: readonly string[] }): Set<string> =>
      new Set(tile.rows.join(""));

    const grass = tokensOf(GRASS);
    const dirt = tokensOf(DIRT_PATH);
    const cap = tokensOf(WALL_TOP);
    const face = tokensOf(WALL_FACE);

    const pairs: ReadonlyArray<readonly [Set<string>, Set<string>]> = [
      [grass, dirt],
      [grass, cap],
      [grass, face],
      [dirt, cap],
      [dirt, face],
      [cap, face],
    ];
    for (const [a, b] of pairs) {
      expect([...a].filter((token) => b.has(token))).toEqual([]);
    }
  });

  it("keeps the seam on one edge only, so a tiled field has single mortar lines", () => {
    for (const tile of [GRASS, DIRT_PATH, WALL_TOP, WALL_SHELF]) {
      expect(tile.rows[0]).not.toBe(tile.rows[TILE_DEPTH - 1]);
    }
  });

  it("stacks the wall face vertically without banding", () => {
    // Anything that spans a whole row repeats every 16px once faces are stacked.
    // Two mortar courses are meant to; a contact shadow is not — it belongs at
    // the foot of the wall, which is one place, not every sixteenth pixel.
    const solidRows = WALL_FACE.rows.filter((row) => new Set(row).size === 1);

    expect(solidRows).toEqual(["m".repeat(TILE_WIDTH), "m".repeat(TILE_WIDTH)]);
    expect(WALL_FACE.rows[WALL_RISE - 1]).not.toBe(WALL_FACE.rows[0]);
  });

  it("darkens the back edge of the wall cap", () => {
    expect(WALL_TOP.rows[0]).toBe("k".repeat(TILE_WIDTH));
  });

  it("takes that lip off the shelf, so the inside of a mass has no bands", () => {
    // The fault this tile exists to prevent: stack `WALL_TOP` down a twenty-cell
    // outcrop and it draws a bright line every twelve pixels. Counting tokens
    // is not enough to catch it - the first attempt at this tile dropped the lit
    // row and kept the near-solid shadow row under it, which still banded and
    // still passed. So measure what the eye measures: how much light each
    // scanline emits, and refuse any that stands out from its neighbours.
    const shelf = rowLight(WALL_SHELF);
    expect(Math.max(...shelf)).toBeLessThanOrEqual(median(shelf) * 3);
  });

  it("would not pass that test with the lip still on, which is the point", () => {
    // A test that both tiles pass is asserting nothing. `WALL_TOP` is right to
    // band - its lip is the far edge of an outcrop - so it is the control.
    const cap = rowLight(WALL_TOP);
    expect(Math.max(...cap)).toBeGreaterThan(median(cap) * 8);
  });

  it("keeps the shelf's body identical to the cap it replaces", () => {
    // Only the lip and its shadow differ. If the bodies ever drift apart, the
    // join between the rear row of a mass and the row in front becomes visible.
    expect(WALL_SHELF.rows.slice(2)).toEqual(WALL_TOP.rows.slice(2));
    expect(WALL_SHELF.palette).toBe(WALL_TOP.palette);
  });

  it("keeps the cap free of vertical lines, so it reads as a top and not as brickwork", () => {
    // A surface seen from a pitched-back camera has no verticals in it. When
    // this tile carried the face's staggered courses, its mortar columns were
    // what made an outcrop read as a brick wall lying flat.
    const body = WALL_TOP.rows.slice(1);

    for (let column = 0; column < TILE_WIDTH; column += 1) {
      const stripe = body.map((row) => row[column]).join("");
      expect(new Set(stripe).size).toBeGreaterThan(1);
    }
  });

  it("keeps grass noise low-contrast, so twenty copies read as a field", () => {
    const counts = new Map<string, number>();
    for (const token of GRASS.rows.join("")) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    const total = TILE_WIDTH * TILE_DEPTH;

    expect((counts.get("G") ?? 0) / total).toBeGreaterThan(0.85);
  });
});
