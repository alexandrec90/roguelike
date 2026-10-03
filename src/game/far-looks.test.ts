import { describe, expect, it } from "vitest";

import { terrainFarLooks } from "./far-looks";
import { DIRT, GRASS } from "./ground/ground-sample";
import { groundTile } from "./ground/ground-tiles";
import { FAR_LEVELS, farMean } from "./roll-far";
import { gridTexels, tileLook } from "./roll-ground";

const looks = terrainFarLooks();
const plainGrass = tileLook(gridTexels(groundTile({ dirt: 0, colours: 0, middle: 0, shade: 0 })));

describe("terrainFarLooks", () => {
  it("carries the meadow's grass, so the far lip keeps the field's shade", () => {
    // The regression: the far lip showed a plain grass tile's commonest ink,
    // a third darker than the field with its tufts, and read as a band of
    // another shade a few rows above the seam.
    const [r, g] = farMean(looks[GRASS]);
    const [plainR, plainG] = farMean(plainGrass);
    expect(r - plainR).toBeGreaterThan(6);
    expect(g - plainG).toBeGreaterThan(5);
  });

  it("holds the grass's lit tips, which no plain tile has", () => {
    const plain = new Set(plainGrass.table);
    const brightest = Math.max(...looks[GRASS].table.map((colour) => ((colour >> 16) & 0xff) + ((colour >> 8) & 0xff)));
    const plainBrightest = Math.max(...[...plain].map((colour) => ((colour >> 16) & 0xff) + ((colour >> 8) & 0xff)));
    expect(brightest).toBeGreaterThan(plainBrightest);
  });

  it("reads dirt as earth, and grass as green", () => {
    const [dirtR, dirtG] = farMean(looks[DIRT]);
    const [grassR, grassG] = farMean(looks[GRASS]);
    expect(dirtR).toBeGreaterThan(grassR);
    expect(grassG).toBeGreaterThan(grassR);
  });

  it("fills every slot, and counts the same look on every load", () => {
    for (const code of [GRASS, DIRT] as const) {
      expect(looks[code].table).toHaveLength(FAR_LEVELS);
      expect(looks[code].table.every((colour) => colour !== 0)).toBe(true);
      expect(Array.from(terrainFarLooks()[code].table)).toEqual(Array.from(looks[code].table));
    }
  });
});
