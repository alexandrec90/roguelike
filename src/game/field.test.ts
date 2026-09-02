import { describe, expect, it } from "vitest";

import {
  cellFoot,
  composeGround,
  faceCells,
  FIELD_MAP,
  isRock,
  PUDDLE_SITES,
  rockCells,
  terrainAt,
  TREE_SITES,
} from "./field";
import { DEFAULT_SKY_FRACTION, horizonLayout } from "./horizon";
import { rasterizeSprite } from "./pixel-art";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import { createPuddle, puddleHolds, rainImpact, type Puddle } from "./puddles";
import { stepEmitter } from "./spark-emitter";
import { TERRAIN_PALETTE } from "./tiles";
import { createRain } from "./weather";

const COLUMNS = 20;
const ROWS = FIELD_MAP.length;

describe("the sample field map", () => {
  it("is rectangular and covers the screen's columns", () => {
    for (const row of FIELD_MAP) {
      expect(row).toHaveLength(COLUMNS);
    }
  });

  it("uses only glyphs the reader knows", () => {
    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        expect(() => terrainAt(column, row)).not.toThrow();
      }
    }
  });

  it("rejects a glyph nobody defined, instead of drawing a hole", () => {
    expect(() => terrainAt(0, 0, ["~"])).toThrow(/Unknown terrain glyph/);
  });

  it("reads grass outside the map, so the field can be bigger than the scene", () => {
    expect(terrainAt(COLUMNS + 5, 0)).toBe("grass");
    expect(terrainAt(0, ROWS + 5)).toBe("grass");
    expect(terrainAt(-1, -1)).toBe("grass");
  });

  it("keeps the path walkable end to end", () => {
    for (let row = 0; row < ROWS; row += 1) {
      expect(FIELD_MAP[row]).toContain(",");
    }
  });

  it("keeps rock off the two rows nearest the horizon", () => {
    // A block's cap is drawn one wall unit above its cell. On row 0 or 1 that
    // reaches up into the rolled-over band, where a near object has no business
    // being.
    expect(FIELD_MAP[0]).not.toContain("#");
    expect(FIELD_MAP[1]).not.toContain("#");
  });
});

describe("rock blocks", () => {
  it("shows a face only where nothing stands in front", () => {
    expect(faceCells(COLUMNS, ROWS)).toEqual([
      { column: 14, row: 4 },
      { column: 15, row: 4 },
      { column: 16, row: 4 },
      { column: 2, row: 8 },
      { column: 3, row: 8 },
      { column: 4, row: 8 },
    ]);
  });

  it("gives a face to the near edge of a one-deep outcrop", () => {
    expect(faceCells(3, 1, ["#.#"])).toEqual([
      { column: 0, row: 0 },
      { column: 2, row: 0 },
    ]);
  });

  it("lists every block far row first, so painting near-last is just insertion order", () => {
    const cells = rockCells(COLUMNS, ROWS);
    const rows = cells.map((cell) => cell.row);

    expect(cells).toHaveLength(18);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    expect(cells.every((cell) => isRock(cell.column, cell.row))).toBe(true);
  });
});

describe("composeGround", () => {
  it("splices the whole playfield into one sprite of the right size", () => {
    const ground = composeGround(COLUMNS, ROWS);
    const raster = rasterizeSprite(ground);

    expect(raster.width).toBe(COLUMNS * TILE_WIDTH);
    expect(raster.height).toBe(ROWS * TILE_DEPTH);
  });

  it("carries every terrain token, because one texture means one palette", () => {
    const ground = composeGround(COLUMNS, ROWS);

    for (const token of Object.keys(TERRAIN_PALETTE)) {
      expect(ground.palette[token]).toBe(TERRAIN_PALETTE[token]);
    }
  });

  it("puts the path where the map says", () => {
    const ground = composeGround(COLUMNS, ROWS);
    // Row 0 of the map is dirt at columns 4-6, so the first scanline of the
    // composed sprite carries dirt tokens across exactly that span.
    const scanline = ground.rows[0] ?? "";

    expect(scanline.slice(4 * TILE_WIDTH, 7 * TILE_WIDTH)).toMatch(/^[dDep]+$/);
    expect(scanline.slice(0, 4 * TILE_WIDTH)).toMatch(/^[gGhs]+$/);
  });
});

describe("cellFoot", () => {
  it("puts an actor's feet on the near edge of its cell, centred", () => {
    expect(cellFoot(10, 11, 9)).toEqual({ x: 10 * TILE_WIDTH + 8, y: 9 + 12 * TILE_DEPTH });
  });
});

describe("tree placement", () => {
  it("roots every tree in visible grass rather than through a path or rock", () => {
    for (const site of TREE_SITES) {
      expect(site.column).toBeGreaterThanOrEqual(0);
      expect(site.column).toBeLessThan(COLUMNS);
      expect(site.row).toBeGreaterThanOrEqual(0);
      expect(site.row).toBeLessThan(ROWS);
      expect(terrainAt(site.column, site.row)).toBe("grass");
    }
  });
});

describe("the storm over the sample field", () => {
  const GROUND_TOP = horizonLayout(180, DEFAULT_SKY_FRACTION).groundTop;

  function sitePuddles(): Puddle[] {
    return PUDDLE_SITES.map((site) => {
      const foot = cellFoot(site.column, site.row, GROUND_TOP);
      return createPuddle({
        id: site.id,
        centerX: foot.x + (site.offsetX ?? 0),
        centerY: foot.y + (site.offsetY ?? 0),
        radius: site.radius,
        seed: site.seed,
      });
    });
  }

  it("gives every site a puddle that stays on screen", () => {
    for (const pool of sitePuddles()) {
      for (const pixel of pool.water) {
        expect(pixel.x).toBeGreaterThanOrEqual(0);
        expect(pixel.x).toBeLessThan(320);
        expect(pixel.y).toBeGreaterThan(GROUND_TOP);
        expect(pixel.y).toBeLessThan(180);
      }
    }
  });

  /**
   * The end-to-end claim the user's request rests on: the rain the scene runs
   * actually reaches the water the field lays out. Nothing below this line is
   * hypothetical — it is `demo-scene`'s own step, minus the drawing.
   */
  it("lands drops in the water often enough to see, and always inside it", () => {
    const puddles = sitePuddles();
    const rain = createRain(320);
    const impacts: { x: number; y: number }[] = [];

    // Ten seconds at 60 fps.
    for (let frame = 0; frame < 600; frame += 1) {
      stepEmitter(rain, 16);
      for (const drop of rain.particles) {
        if (!drop.active) {
          continue;
        }
        const impact = rainImpact(
          puddles,
          drop.x - drop.vx * 16,
          drop.y - drop.vy * 16,
          drop.x,
          drop.y,
        );
        if (impact !== null) {
          impacts.push({ x: impact.x, y: impact.y });
          drop.active = false;
        }
      }
    }

    // A ring lives RIPPLE_LIFE_MS, so this rate is what decides whether the
    // storm ever shows one. Two a second keeps roughly one on screen at all
    // times, which is the floor for "the rain leaves ripples" being true.
    expect(impacts.length / 10).toBeGreaterThan(2);

    for (const impact of impacts) {
      expect(puddles.some((pool) => puddleHolds(pool, impact.x, impact.y))).toBe(true);
    }

    // And they are spread over the field rather than all going into one pool.
    const hit = new Set(
      impacts.map(
        (impact) => puddles.find((pool) => puddleHolds(pool, impact.x, impact.y))?.id ?? "",
      ),
    );
    expect(hit.size).toBeGreaterThan(3);
  });
});
