import { describe, expect, it } from "vitest";

import type { Lake } from "../../game/lakes";
import { FIELD_SIZE, TEXELS_PER_TILE } from "../../game/water/puddle-field";
import { LAKE_RANGE_TILES, lakeShoreAt, waterTexels } from "./water-texels";

const lake = { x: 20, y: 30, seed: 77, shore: 1.5, reach: 2.5 } as Lake;
const field = new Uint8Array(FIELD_SIZE * FIELD_SIZE).fill(9);

function texelAt(texels: Uint8Array, x: number, y: number, channel: number): number {
  const i = ((Math.floor(x * TEXELS_PER_TILE) % FIELD_SIZE) + FIELD_SIZE) % FIELD_SIZE;
  const j = ((Math.floor(y * TEXELS_PER_TILE) % FIELD_SIZE) + FIELD_SIZE) % FIELD_SIZE;
  return texels[(j * FIELD_SIZE + i) * 2 + channel] ?? -1;
}

/** What the shaders decode from green: tiles inside the shore. */
const tilesInside = (byte: number): number => (byte / 255 - 0.5) * LAKE_RANGE_TILES;

describe("a lake's shore", () => {
  it("never comes nearer than its shore nor goes farther than its reach", () => {
    for (let step = 0; step < 360; step += 1) {
      const radius = lakeShoreAt(lake, (step / 360) * Math.PI * 2);
      expect(radius).toBeGreaterThanOrEqual(lake.shore);
      expect(radius).toBeLessThanOrEqual(lake.reach);
    }
  });

  it("is one closed outline: the same a full turn round, and lobed rather than round", () => {
    expect(lakeShoreAt(lake, 0.3)).toBeCloseTo(lakeShoreAt(lake, 0.3 + Math.PI * 2), 9);
    expect(lakeShoreAt(lake, -0.3)).toBeCloseTo(lakeShoreAt(lake, Math.PI * 2 - 0.3), 9);
    const radii = Array.from({ length: 36 }, (_, step) => lakeShoreAt(lake, (step / 36) * Math.PI * 2));
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.1);
  });
});

describe("the water mask", () => {
  const texels = waterTexels(field, [lake]);

  it("carries the puddle basins in red, untouched by a lake", () => {
    expect(texelAt(texels, 20, 30, 0)).toBe(9);
    expect(texelAt(texels, 100, 100, 0)).toBe(9);
  });

  it("is water past a half of green inside the shore, and dry past it - what the wave simulation tests", () => {
    for (let step = 0; step < 16; step += 1) {
      const angle = (step / 16) * Math.PI * 2;
      const shore = lakeShoreAt(lake, angle);
      const at = (distance: number): number =>
        texelAt(texels, lake.x + Math.cos(angle) * distance, lake.y + Math.sin(angle) * distance, 1) / 255;
      expect(at(shore - 0.5)).toBeGreaterThan(0.5);
      expect(at(shore + 0.5)).toBeLessThan(0.5);
    }
  });

  it("holds the distance inside the shore, so the shaders can draw a smooth edge and a deeper middle", () => {
    const centre = tilesInside(texelAt(texels, lake.x, lake.y, 1));
    const halfway = tilesInside(texelAt(texels, lake.x + lake.shore / 2, lake.y, 1));
    expect(centre).toBeGreaterThan(halfway);
    expect(centre).toBeCloseTo(lakeShoreAt(lake, Math.atan2(0.125, 0.125)) - Math.hypot(0.125, 0.125), 0);
  });

  it("falls to nothing before the edge of the box it is written over, so no lake is cut square", () => {
    const far = lake.reach + LAKE_RANGE_TILES / 2 + 0.5;
    expect(texelAt(texels, lake.x + far, lake.y, 1)).toBe(0);
    expect(texelAt(texels, lake.x, lake.y - far, 1)).toBe(0);
  });

  it("keeps the nearer lake's water where two lakes' fields overlap", () => {
    const other = { ...lake, x: lake.x + 6, seed: 12 } as Lake;
    const both = waterTexels(field, [lake, other]);
    const alone = waterTexels(field, [other]);
    expect(texelAt(both, other.x, other.y, 1)).toBe(texelAt(alone, other.x, other.y, 1));
    expect(texelAt(both, lake.x, lake.y, 1)).toBe(texelAt(texels, lake.x, lake.y, 1));
  });

  it("wraps round the planet's seam", () => {
    const seam = { ...lake, x: 0.5 } as Lake;
    const wrapped = waterTexels(field, [seam]);
    expect(texelAt(wrapped, -0.75, lake.y, 1) / 255).toBeGreaterThan(0.5);
  });
});
