import { describe, expect, it } from "vitest";

import { nearLake } from "../lakes";
import { blockedByLand } from "../landforms";
import { PLANET_TILES } from "../planet";
import { FIELD_SIZE, puddleDepth, puddleField, sampleField, TEXELS_PER_TILE, waterLevel } from "./puddle-field";

const field = puddleField();

/** Share of open ground (not land, not lake bank) under water at this wetness. */
function underWater(wetness: number): number {
  const level = waterLevel(wetness) * 255;
  let open = 0;
  let wet = 0;
  for (const basin of field) {
    if (basin > 0) {
      open += 1;
      wet += basin > level ? 1 : 0;
    }
  }
  return wet / open;
}

describe("the puddle field", () => {
  it("covers the planet once, a lap a side", () => {
    expect(field).toHaveLength(FIELD_SIZE * FIELD_SIZE);
    expect(FIELD_SIZE).toBe(PLANET_TILES * TEXELS_PER_TILE);
    expect(puddleField()).toBe(field);
  });

  it("holds some water on a dry day and much more after a downpour", () => {
    expect(underWater(0)).toBeGreaterThan(0.05);
    expect(underWater(0)).toBeLessThan(0.11);
    expect(underWater(1)).toBeGreaterThan(0.22);
    expect(underWater(1)).toBeLessThan(0.33);
    expect(waterLevel(0.5)).toBeLessThan(waterLevel(0));
    expect(waterLevel(-1)).toBe(waterLevel(0));
    expect(waterLevel(2)).toBe(waterLevel(1));
  });

  it("never stands water in a landform or on a lake's bank - the same tiles the slow questions name", () => {
    for (let ty = 0; ty < PLANET_TILES; ty += 3) {
      for (let tx = 0; tx < PLANET_TILES; tx += 3) {
        const centre = { x: tx + 0.5, y: ty + 0.5 };
        if (blockedByLand(centre) || nearLake(centre, 1)) {
          const sample = (ty * TEXELS_PER_TILE + 1) * FIELD_SIZE + tx * TEXELS_PER_TILE + 1;
          expect(field[sample], `tile ${tx},${ty}`).toBe(0);
        }
      }
    }
  });

  it("reads bilinearly between samples, exactly on a sample's centre, and wraps", () => {
    const i = 413;
    const j = 207;
    const centre = { x: (i + 0.5) / TEXELS_PER_TILE, y: (j + 0.5) / TEXELS_PER_TILE };
    expect(sampleField(field, centre)).toBeCloseTo((field[j * FIELD_SIZE + i] ?? 0) / 255, 9);
    expect(sampleField(field, { x: centre.x + PLANET_TILES, y: centre.y - PLANET_TILES })).toBeCloseTo(sampleField(field, centre), 9);
    const between = sampleField(field, { x: centre.x + 0.5 / TEXELS_PER_TILE, y: centre.y });
    const a = (field[j * FIELD_SIZE + i] ?? 0) / 255;
    const b = (field[j * FIELD_SIZE + i + 1] ?? 0) / 255;
    expect(between).toBeCloseTo((a + b) / 2, 9);
  });

  it("says how deep the water stands, and none where it is dry", () => {
    let deepest = { point: { x: 0, y: 0 }, basin: 0 };
    for (let j = 0; j < FIELD_SIZE; j += 7) {
      for (let i = 0; i < FIELD_SIZE; i += 7) {
        const basin = field[j * FIELD_SIZE + i] ?? 0;
        if (basin > deepest.basin) {
          deepest = { point: { x: (i + 0.5) / TEXELS_PER_TILE, y: (j + 0.5) / TEXELS_PER_TILE }, basin };
        }
      }
    }
    expect(puddleDepth(deepest.point, 0)).toBeGreaterThan(0);
    expect(puddleDepth(deepest.point, 1)).toBeGreaterThan(puddleDepth(deepest.point, 0));
    expect(puddleDepth({ x: 0.5, y: 0.5 }, 0)).toBeGreaterThanOrEqual(0);
  });
});
