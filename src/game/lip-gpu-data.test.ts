import { describe, expect, it } from "vitest";

import type { CameraFrame } from "./camera";
import { BEND_LEVELS, TUFT_FRAME, TUFT_SHAPES, tuftCloud } from "./ground/tufts";
import {
  CellTable,
  lineTable,
  lipLines,
  MAX_LINES,
  NEEDS_FAR,
  NEEDS_TILE,
  NEEDS_TUFTS,
  PageAtlas,
  STRIDE_SHIFTS,
  texelColumn,
  tilePage,
  tuftAtlas,
  tuftAtlasFrame,
  TuftTable,
  TUFTS_PER_CELL,
  visitLipCells,
  warmChunks,
} from "./lip-gpu-data";
import { packCloud } from "./roll-grass";
import { rollGroundPixels, rollScanlines, type CellLook, type TileTexels } from "./roll-ground";

const FRAME: CameraFrame = { groundTop: 40, rollHeight: 24, footX: 160, footY: 121, phaseX: 0.2, phaseY: -0.35 };
const WIDTH = 320;

function plainTile(value: number): TileTexels {
  const rgba = new Uint8ClampedArray(16 * 12 * 4).fill(value);
  return { width: 16, rgba };
}

describe("lipLines", () => {
  it("reads the rows and scales rollGroundPixels reads, scroll included", () => {
    const scanlines = rollScanlines({ ...FRAME, phaseX: 0, phaseY: 0 });
    const shift = { x: -3, y: 4 };
    const lines = lipLines(FRAME, shift);
    expect(lines).toHaveLength(FRAME.rollHeight);
    const seam = (FRAME.footY + shift.y - FRAME.groundTop) / 12;
    lines.forEach((line, index) => {
      const scan = scanlines[index]!;
      expect(line.gy).toBe(Math.floor((seam + scan.rowsBeyond) * 12));
      expect(line.invScale).toBeCloseTo(1 / scan.scale, 12);
      expect(line.y).toBe(scan.y);
    });
  });

  it("puts each pixel on the world texel column rollGroundPixels puts it on", () => {
    const shift = { x: 5, y: 0 };
    for (const line of lipLines(FRAME, shift)) {
      const span = 16 / line.invScale;
      for (let x = 0; x < WIDTH; x += 7) {
        const localX = (x + 0.5 - FRAME.footX) / span - shift.x / 16;
        expect(texelColumn(x, line, FRAME, shift.x)).toBe(Math.floor((localX + 0.5) * 16));
      }
    }
  });

  it("packs a line table of two rows, the second holding the tufted flag and the screen y", () => {
    const lines = lipLines(FRAME);
    const table = lineTable(lines);
    expect(table).toHaveLength(MAX_LINES * 2 * 4);
    const last = lines.length - 1;
    expect(table[last * 4]).toBe(lines[last]!.gy);
    expect(table[(MAX_LINES + last) * 4]).toBe(lines[last]!.tufted ? 1 : 0);
    expect(table[(MAX_LINES + last) * 4 + 1]).toBe(lines[last]!.y);
  });
});

describe("visitLipCells", () => {
  it("visits every cell a CPU lip reads, with what it reads of it", () => {
    const visited = new Map<string, number>();
    visitLipCells(FRAME, WIDTH, { x: [-3], y: [4] }, (cellX, cellY, needs) => {
      visited.set(`${cellX},${cellY}`, (visited.get(`${cellX},${cellY}`) ?? 0) | needs);
    });
    const read: { kind: number; cell: string }[] = [];
    const look: CellLook = {
      tile: (cellX, cellY) => {
        read.push({ kind: NEEDS_TILE, cell: `${cellX},${cellY}` });
        return plainTile(80);
      },
      tuft: (cellX, cellY) => {
        read.push({ kind: NEEDS_TUFTS, cell: `${cellX},${cellY}` });
        return null;
      },
      far: (cellX, cellY) => {
        read.push({ kind: NEEDS_FAR, cell: `${cellX},${cellY}` });
        return 0x336633;
      },
    };
    // A frame whose scroll is the one visited: phase -> scroll is scrollOffset's.
    const frame = { ...FRAME, phaseX: 3 / 16, phaseY: 4 / 12 };
    rollGroundPixels(frame, WIDTH, look, { r: 200, g: 200, b: 220 });
    expect(read.length).toBeGreaterThan(0);
    for (const { kind, cell } of read) {
      expect(((visited.get(cell) ?? 0) & kind) !== 0, `${cell} for ${kind}`).toBe(true);
    }
  });

  it("covers every scroll a stride can reach when asked for the whole range", () => {
    const one = new Set<string>();
    const all = new Set<string>();
    visitLipCells(FRAME, WIDTH, { x: [16], y: [-12] }, (x, y) => one.add(`${x},${y}`));
    visitLipCells(FRAME, WIDTH, STRIDE_SHIFTS, (x, y) => all.add(`${x},${y}`));
    for (const cell of one) {
      expect(all.has(cell)).toBe(true);
    }
  });

  it("walks only the scanlines asked for", () => {
    const top = new Set<number>();
    visitLipCells(FRAME, WIDTH, { x: [0], y: [0] }, (_x, y) => top.add(y), { from: 0, to: 1 });
    expect(top.size).toBe(1);
  });
});

describe("warmChunks", () => {
  it("cuts cells into tasks by cost, in order, a tile costing far more than a far colour", () => {
    const far = Array.from({ length: 100 }, (_unused, index) => [index, 20, NEEDS_FAR] as const);
    const near = Array.from({ length: 30 }, (_unused, index) => [index, 8, NEEDS_TILE | NEEDS_TUFTS] as const);
    const chunks = warmChunks([...far, ...near], 320);
    expect(chunks.flat()).toEqual([...far, ...near]);
    const cost = (chunk: readonly (readonly [number, number, number])[]): number =>
      chunk.reduce((sum, cell) => sum + (cell[2] === NEEDS_FAR ? 1 : 29), 0);
    expect(chunks.every((chunk) => cost(chunk) <= 320)).toBe(true);
    // A hundred far colours cost less than a dozen tiles, so all of them share a task.
    expect(chunks[0]!.slice(0, 100)).toEqual(far);
    // 100 + 7 tiles, then 11, 11 and the last 1: greedy, in order.
    expect(chunks.map((chunk) => chunk.length)).toEqual([107, 11, 11, 1]);
  });

  it("gives a cell over the limit a task of its own, and nothing for no cells", () => {
    expect(warmChunks([[0, 0, NEEDS_TILE]], 1)).toEqual([[[0, 0, NEEDS_TILE]]]);
    expect(warmChunks([])).toEqual([]);
  });
});

describe("PageAtlas", () => {
  it("fills a page once, never hands out slot 0, and reports the rows it changed", () => {
    const atlas = new PageAtlas(4, 2);
    let fills = 0;
    const fill = (data: Uint8Array, at: number): void => {
      fills += 1;
      data[at] = 9;
    };
    const slot = atlas.slotFor("a", fill);
    expect(slot).toBe(1);
    expect(atlas.slotFor("a", fill)).toBe(slot);
    expect(fills).toBe(1);
    expect(atlas.data[atlas.origin(slot).x * 4]).toBe(9);
    expect(atlas.takeDirty()).toEqual({ from: 0, to: 12 });
    expect(atlas.takeDirty()).toBeUndefined();
  });

  it("evicts the least recently used page when full, never one used this frame", () => {
    const atlas = new PageAtlas(2, 2); // three usable slots
    const fill = (): void => undefined;
    atlas.slotFor("a", fill);
    atlas.slotFor("b", fill);
    atlas.slotFor("c", fill);
    atlas.tick();
    atlas.slotFor("b", fill);
    atlas.slotFor("c", fill);
    const d = atlas.slotFor("d", fill);
    expect(d).toBe(1); // a's slot: the one not asked for since
    atlas.tick();
    let refilled = false;
    atlas.slotFor("a", () => {
      refilled = true;
    });
    expect(refilled).toBe(true);
  });

  it("throws rather than overwrite a page this frame still needs", () => {
    const atlas = new PageAtlas(2, 1); // one usable slot
    atlas.slotFor("a", () => undefined);
    expect(() => atlas.slotFor("b", () => undefined)).toThrow(/full/);
  });

  it("copies a tile into a page row for row, and clears a reused page first", () => {
    const atlas = new PageAtlas(2, 1);
    const slot = atlas.slotFor("tile", (data, at, stride) => tilePage(plainTile(70), data, at, stride));
    const { x, y } = atlas.origin(slot);
    expect(atlas.data[((y + 11) * atlas.width + x + 15) * 4]).toBe(70);
    atlas.tick();
    const again = atlas.slotFor("other", () => undefined);
    expect(again).toBe(slot);
    expect(atlas.data[((y + 11) * atlas.width + x + 15) * 4]).toBe(0);
  });
});

describe("the cell and tuft tables", () => {
  const bounds = { minX: -2, maxX: 2, minY: 3, maxY: 5 };

  it("addresses a cell, ignores one outside, and marks itself dirty only on a change", () => {
    const table = new CellTable(bounds);
    table.dirty = false;
    table.set(-2, 3, 1, 2);
    expect(table.dirty).toBe(true);
    expect(table.get(-2, 3, 1)).toBe(2);
    table.dirty = false;
    table.set(-2, 3, 1, 2);
    table.set(9, 9, 0, 5);
    expect(table.dirty).toBe(false);
    expect(table.index(9, 9)).toBe(-1);
  });

  it("holds up to three tufts a cell, empties the rest, and reports the rows it changed", () => {
    const table = new TuftTable(bounds);
    expect(table.width).toBe(5 * TUFTS_PER_CELL);
    expect(table.has(0, 4)).toBe(false);
    table.set(0, 4, [
      { frame: 5, dx: 3, dy: 4 },
      { frame: 6, dx: 1, dy: 2 },
    ]);
    const base = (1 * table.width + 2 * TUFTS_PER_CELL) * 4;
    expect([...table.data.slice(base, base + 8)]).toEqual([6, 3, 4, 0, 7, 1, 2, 0]);
    expect(table.has(0, 4)).toBe(true);
    expect(table.has(1, 4)).toBe(false);
    expect(table.has(9, 9)).toBe(false);
    expect(table.takeDirty()).toEqual({ from: 1, to: 2 });
    table.set(0, 4, [{ frame: 5, dx: 3, dy: 4 }]);
    expect(table.data[base + 4]).toBe(0);
    table.set(0, 4, [{ frame: 5, dx: 3, dy: 4 }]);
    table.takeDirty();
    table.set(0, 4, [{ frame: 5, dx: 3, dy: 4 }]);
    expect(table.takeDirty()).toBeUndefined();
    table.markAll();
    expect(table.takeDirty()).toEqual({ from: 0, to: 3 });
  });
});

describe("tuftAtlas", () => {
  it("holds every pixel of every tuft at every bend, the last of a cloud winning as the overlay stamps it", () => {
    const atlas = tuftAtlas();
    TUFT_SHAPES.forEach((shape, shapeIndex) => {
      for (let bend = 0; bend < BEND_LEVELS; bend += 1) {
        const frame = tuftAtlasFrame(shapeIndex, bend);
        expect(frame % BEND_LEVELS).toBe(bend);
        const packed = packCloud(tuftCloud(shape, bend)).data;
        const last = new Map<string, number[]>();
        for (let at = 0; at < packed.length; at += 6) {
          const u = TUFT_FRAME.originX + packed[at]!;
          const v = TUFT_FRAME.originY + packed[at + 1]!;
          expect(u >= 0 && v >= 0 && u < TUFT_FRAME.width && v < TUFT_FRAME.height).toBe(true);
          last.set(`${u},${v}`, [packed[at + 2]!, packed[at + 3]!, packed[at + 4]!, packed[at + 5]!]);
        }
        for (const [key, rgba] of last) {
          const [u, v] = key.split(",").map(Number) as [number, number];
          const to = ((shapeIndex * TUFT_FRAME.height + v) * atlas.width + bend * TUFT_FRAME.width + u) * 4;
          expect([...atlas.data.slice(to, to + 4)]).toEqual(rgba);
        }
      }
    });
  });
});
