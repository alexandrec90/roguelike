import { describe, expect, it } from "vitest";

import type { CameraFrame } from "./camera";
import { createLandformPixels, NO_ROW, type LandformLight, type LandformView } from "./landform-frame";
import {
  groupRows,
  radialProfile,
  RADIAL_STEP,
  rowBase,
  rowCode,
  rowRects,
  stackBands,
  type Obstacle,
  type RowGroup,
  type RowRect,
} from "./landform-gpu-rows";
import { renderLandforms } from "./landform-render";
import { fieldHeight, landformField, type Landform } from "./landforms";
import { RANK, standingDepth } from "./projection";

const FRAME: CameraFrame = { groundTop: 40, rollHeight: 24, footX: 160, footY: 113, phaseX: 0, phaseY: 0 };
const WIDTH = 320;
const HEIGHT = 180;
const LIGHT: LandformLight = { light: { x: -0.6, y: -0.8 }, elevation: 0.7, turn: 0, haze: { r: 180, g: 200, b: 220 } };

let serial = 0;

function landform(kind: Landform["kind"], radius: number, height: number): Landform {
  serial += 1;
  return { id: `gpu-rows-${kind}-${serial}`, kind, x: 0, y: 0, radius, height, seed: 0xabcdef - serial };
}

function view(of: Landform, x: number, y: number): LandformView {
  return { field: landformField(of), centreX: x, centreY: y };
}

const MOUNTAIN = landform("mountain", 10, 300);
const TOWER = landform("tower", 1.6, 160);
const MESA = landform("mesa", 5, 90);

/** A scene with near, far and sunk land in it: a mountain behind the hero, a tower and a mesa ahead. */
const SCENE: readonly LandformView[] = [view(MOUNTAIN, -12, -14), view(TOWER, 3, 4), view(MESA, -20, 40)];

describe("radialProfile", () => {
  it("bounds every height the field can return at or beyond each distance", () => {
    for (const of of [MOUNTAIN, TOWER, MESA]) {
      const field = landformField(of);
      const profile = radialProfile(field);
      for (let index = 0; index < 400; index += 1) {
        const angle = index * 2.399963;
        const r = (((index * 7919) % 1000) / 1000) * field.half * 1.3;
        const h = fieldHeight(field, Math.cos(angle) * r, Math.sin(angle) * r);
        const bucket = Math.min(profile.length - 1, Math.floor(r / RADIAL_STEP));
        expect(profile[bucket] ?? 0).toBeGreaterThanOrEqual(h - 1e-4);
      }
    }
  });
});

describe("rowRects", () => {
  it("holds every pixel the CPU march paints on each row inside that row's rectangle", () => {
    const pixels = createLandformPixels(WIDTH, HEIGHT);
    renderLandforms(FRAME, SCENE, LIGHT, pixels);
    const rects = new Map<number, RowRect>(rowRects(FRAME, SCENE, WIDTH, HEIGHT).map((rect) => [rect.row, rect]));
    let checked = 0;
    pixels.rows.forEach((row, index) => {
      if (row === NO_ROW) {
        return;
      }
      const x = index % WIDTH;
      const y = Math.floor(index / WIDTH);
      const rect = rects.get(row);
      expect(rect, `row ${row} at ${x},${y}`).toBeDefined();
      expect(x).toBeGreaterThanOrEqual(rect?.left ?? Infinity);
      expect(x).toBeLessThan(rect?.right ?? -Infinity);
      expect(y).toBeGreaterThanOrEqual(rect?.top ?? Infinity);
      expect(y).toBeLessThan(rect?.bottom ?? -Infinity);
      checked += 1;
    });
    expect(checked).toBeGreaterThan(1000);
  });
});

describe("rowBase and rowCode", () => {
  it("keeps the nearest 254 rows apart and folds anything farther into the first code", () => {
    expect(rowBase([-300, -10, 12])).toBe(12 - 253);
    expect(rowBase([-5, 3])).toBe(-5);
    expect(rowBase([])).toBe(0);
    expect(rowCode(-5, -5)).toBe(1);
    expect(rowCode(3, -5)).toBe(9);
    expect(rowCode(-400, -5)).toBe(1);
    expect(rowCode(1000, -5)).toBe(255);
  });
});

describe("groupRows", () => {
  const depth = (row: number): number => standingDepth(row, RANK.body);
  const rect = (row: number, top = 0, bottom = 50): RowRect => ({ row, left: 0, top, right: 100, bottom });
  const rows = [rect(1), rect(2), rect(3), rect(4)];
  const tree = (row: number, rank: number, left = 10): Obstacle => ({
    depth: standingDepth(row, rank),
    left,
    top: 10,
    right: left + 10,
    bottom: 40,
  });

  it("draws rows nothing stands between as one slice, at the nearest row's depth", () => {
    const groups = groupRows(rows, 0, [], depth);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ lowCode: rowCode(1, 0), highCode: rowCode(4, 0), depth: depth(4) });
  });

  it("cuts between two rows where something sorted between them overlaps the farther one", () => {
    const groups = groupRows(rows, 0, [tree(2, RANK.actor)], depth);
    expect(groups.map((group) => [group.lowCode, group.highCode])).toEqual([
      [rowCode(1, 0), rowCode(2, 0)],
      [rowCode(3, 0), rowCode(4, 0)],
    ]);
  });

  it("ignores something between rows that overlaps none of them on screen", () => {
    expect(groupRows(rows, 0, [tree(2, RANK.actor, 500)], depth)).toHaveLength(1);
  });

  it("takes a tie with a row the cautious way: it may not join the rows behind, nor rows in front join it", () => {
    const groups = groupRows(rows, 0, [tree(3, RANK.body)], depth);
    expect(groups.map((group) => [group.lowCode, group.highCode])).toEqual([
      [rowCode(1, 0), rowCode(2, 0)],
      [rowCode(3, 0), rowCode(3, 0)],
      [rowCode(4, 0), rowCode(4, 0)],
    ]);
  });

  it("covers each row exactly once", () => {
    const groups = groupRows(rows, 0, [tree(1, RANK.actor), tree(3, RANK.grass)], depth);
    const covered = groups.flatMap((group) => {
      const found: number[] = [];
      for (let code = group.lowCode; code <= group.highCode; code += 1) {
        found.push(code);
      }
      return found;
    });
    expect(covered).toEqual(rows.map((row) => rowCode(row.row, 0)));
  });
});

describe("stackBands", () => {
  const group = (row: number, top: number, bottom: number): RowGroup => ({
    lowCode: row,
    highCode: row,
    depth: row,
    rect: { row, left: 0, top, right: 10, bottom },
  });

  it("stacks each group's rectangle below the last, without gaps", () => {
    const bands = stackBands([group(1, 0, 30), group(2, 10, 20), group(3, 5, 45)], 1000);
    expect(bands.map((band) => band.atlasY)).toEqual([0, 30, 40]);
  });

  it("folds what does not fit into the last band that does, keeping inside the atlas", () => {
    const bands = stackBands([group(1, 0, 30), group(2, 0, 30), group(3, 0, 30)], 70);
    expect(bands).toHaveLength(2);
    const last = bands[1];
    expect(last?.group.lowCode).toBe(2);
    expect(last?.group.highCode).toBe(3);
    expect((last?.atlasY ?? 0) + ((last?.group.rect.bottom ?? 0) - (last?.group.rect.top ?? 0))).toBeLessThanOrEqual(70);
  });
});
