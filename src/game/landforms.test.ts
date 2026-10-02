import { describe, expect, it } from "vitest";

import {
  BLOCK_HEIGHT,
  blockedByLand,
  CLIFF,
  fieldBound,
  fieldHeight,
  GRASS,
  isRoofed,
  LANDFORM_CELL,
  landformField,
  landformShape,
  landformsNear,
  landHeightAt,
  openGround,
  planetLandforms,
  ROOF,
  SNOW,
  WALL,
  type Landform,
  type LandformKind,
} from "./landforms";
import { PLANET_TILES, wrapDelta } from "./planet";

const ALL = planetLandforms();

function first(kind: LandformKind): Landform {
  const found = ALL.find((landform) => landform.kind === kind);
  if (found === undefined) {
    throw new Error(`no ${kind} on the planet`);
  }
  return found;
}

describe("planetLandforms", () => {
  it("is the same planet every time, with every kind on it", () => {
    expect(planetLandforms()).toBe(ALL);
    const kinds = new Set(ALL.map((landform) => landform.kind));
    expect(kinds).toEqual(new Set(["mountain", "mesa", "spire", "tower"]));
    expect(ALL.length).toBeGreaterThan(20);
    expect(ALL.length).toBeLessThanOrEqual((PLANET_TILES / LANDFORM_CELL) ** 2);
  });

  it("never lets two footprints touch", () => {
    for (const a of ALL) {
      for (const b of ALL) {
        if (a === b) {
          continue;
        }
        const apart = Math.hypot(wrapDelta(a.x, b.x), wrapDelta(a.y, b.y));
        expect(apart).toBeGreaterThan(a.radius + b.radius + 1.5);
      }
    }
  });

  it("finds what is in reach, across the planet's wrap", () => {
    const landform = ALL[0] as Landform;
    expect(landformsNear(landform, 0)).toContain(landform);
    const across = { x: (landform.x + PLANET_TILES / 2) % PLANET_TILES, y: landform.y };
    expect(landformsNear(across, 10)).not.toContain(landform);
    const wrapped = { x: landform.x + PLANET_TILES, y: landform.y - PLANET_TILES };
    expect(landformsNear(wrapped, 1)).toContain(landform);
  });
});

describe("landformShape", () => {
  it("stands inside its footprint and nowhere outside it", () => {
    for (const landform of ALL.slice(0, 12)) {
      const shape = landformShape(landform);
      expect(shape(0, 0)).toBeGreaterThan(BLOCK_HEIGHT);
      for (let angle = 0; angle < Math.PI * 2; angle += 0.4) {
        const r = landform.radius + 1.2;
        expect(shape(Math.cos(angle) * r, Math.sin(angle) * r)).toBe(0);
      }
    }
  });

  it("gives each kind its own profile: a mesa's top is flat, a tower's sides are sheer", () => {
    const mesa = landformShape(first("mesa"));
    const { radius: R, height: H } = first("mesa");
    expect(mesa(0, 0)).toBeGreaterThan(H * 0.9);
    expect(mesa(R * 0.3, 0)).toBeGreaterThan(H * 0.9);
    const tower = first("tower");
    const towerShape = landformShape(tower);
    expect(towerShape(tower.radius - 0.05, 0)).toBeGreaterThanOrEqual(tower.height);
    expect(towerShape(tower.radius + 0.05, 0)).toBe(0);
  });

  it("is as tall as a mountain should be", () => {
    const mountain = first("mountain");
    expect(landformShape(mountain)(0, 0)).toBeGreaterThan(mountain.height * 0.7);
    expect(mountain.height).toBeGreaterThan(200);
  });
});

describe("landformField", () => {
  it("is built once and kept", () => {
    expect(landformField(ALL[0] as Landform)).toBe(landformField(ALL[0] as Landform));
  });

  it("matches the shape on its own samples, and stays between them off them", () => {
    const landform = first("mountain");
    const field = landformField(landform);
    const shape = landformShape(landform);
    for (const [dx, dy] of [
      [0, 0],
      [2, -1],
      [-4, 3.5],
    ] as const) {
      // Sample (i, j) sits at `i / res - half`: snap to the nearest one.
      const sx = Math.round((dx + field.half) * field.res) / field.res - field.half;
      const sy = Math.round((dy + field.half) * field.res) / field.res - field.half;
      expect(fieldHeight(field, sx, sy)).toBeCloseTo(shape(sx, sy), 2);
    }
    expect(fieldHeight(field, field.half + 5, 0)).toBe(0);
  });

  it("bounds every height from above with its block's maximum", () => {
    for (const landform of [first("mountain"), first("tower"), first("mesa"), first("spire")]) {
      const field = landformField(landform);
      for (let dx = -landform.radius - 1; dx < landform.radius + 1; dx += 0.37) {
        for (let dy = -landform.radius - 1; dy < landform.radius + 1; dy += 0.41) {
          expect(fieldBound(field, dx, dy)).toBeGreaterThanOrEqual(fieldHeight(field, dx, dy) - 1e-3);
        }
      }
    }
  });

  it("dresses each kind in its own materials", () => {
    const mountain = landformField(first("mountain"));
    expect(mountain.materials.includes(SNOW)).toBe(true);
    const mesa = landformField(first("mesa"));
    expect(mesa.materials.includes(CLIFF)).toBe(true);
    expect(mesa.materials.includes(GRASS)).toBe(true);
    const tower = first("tower");
    const towerField = landformField(tower);
    expect(towerField.materials.includes(WALL)).toBe(true);
    expect(towerField.materials.includes(ROOF)).toBe(isRoofed(tower));
  });

  it("carries unit normals and a bounded detail", () => {
    const field = landformField(first("spire"));
    for (let index = 0; index < field.heights.length; index += 7) {
      const nx = field.normalX[index] ?? 0;
      const ny = field.normalY[index] ?? 0;
      expect(nx * nx + ny * ny).toBeLessThanOrEqual(1 + 1e-6);
      expect(Math.abs(field.detail[index] ?? 0)).toBeLessThanOrEqual(1.01);
    }
  });
});

describe("standing and blocking", () => {
  it("reports the land's height at a planet point, zero in the open", () => {
    const mountain = first("mountain");
    expect(landHeightAt(mountain)).toBeGreaterThan(mountain.height * 0.6);
    expect(landHeightAt({ x: mountain.x + mountain.radius + 3, y: mountain.y })).toBe(0);
  });

  it("blocks the inside of a landform and nothing beyond its foot", () => {
    const tower = first("tower");
    expect(blockedByLand(tower)).toBe(true);
    expect(blockedByLand({ x: tower.x + tower.radius + 1, y: tower.y })).toBe(false);
  });

  it("finds somewhere to stand next to a point inside a landform", () => {
    const mountain = first("mountain");
    const out = openGround(mountain);
    expect(blockedByLand(out)).toBe(false);
    const clear = { x: mountain.x + mountain.radius + 4, y: mountain.y };
    expect(openGround(clear)).toEqual(clear);
  });
});
