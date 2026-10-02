import { describe, expect, it } from "vitest";

import { countColours, FAR_LEVELS, farLook, farMean, farSlot } from "./roll-far";

function slotsOf(table: Uint32Array, colour: number): number {
  return table.filter((entry) => entry === colour).length;
}

describe("countColours", () => {
  it("counts each opaque pixel under its packed colour, and skips holes", () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 255, 1, 2, 3, 0, 40, 50, 60, 128]);
    const counts = countColours(rgba, new Map());
    expect(counts.get(0x0a141e)).toBe(2);
    expect(counts.get(0x28323c)).toBe(1);
    expect(counts.has(0x010203)).toBe(false);
  });

  it("adds to the counts it is handed", () => {
    const counts = countColours(new Uint8ClampedArray([1, 1, 1, 255]), new Map([[0x010101, 4]]));
    expect(counts.get(0x010101)).toBe(5);
  });
});

describe("farLook", () => {
  it("shares the slots out in proportion, every slot filled", () => {
    const look = farLook(new Map([[0x111111, 3], [0x222222, 1]]));
    expect(look.table).toHaveLength(FAR_LEVELS);
    expect(slotsOf(look.table, 0x111111)).toBe(FAR_LEVELS * 0.75);
    expect(slotsOf(look.table, 0x222222)).toBe(FAR_LEVELS * 0.25);
  });

  it("rounds by largest remainder, so the shares still fill the table exactly", () => {
    const look = farLook(new Map([[0xaa0000, 1], [0x00aa00, 1], [0x0000aa, 1]]));
    const shares = [0xaa0000, 0x00aa00, 0x0000aa].map((colour) => slotsOf(look.table, colour));
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(FAR_LEVELS);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
  });

  it("drops a colour too rare for one slot, but never the commonest", () => {
    const look = farLook(new Map([[0x123456, 1000], [0x654321, 1]]));
    expect(slotsOf(look.table, 0x123456)).toBe(FAR_LEVELS);
    expect(slotsOf(look.table, 0x654321)).toBe(0);
  });

  it("is black with nothing counted", () => {
    expect(Array.from(farLook(new Map()).table)).toEqual(new Array(FAR_LEVELS).fill(0));
  });

  it("is the same look whatever order the counts came in", () => {
    const a = farLook(new Map([[1, 5], [2, 5], [3, 2]]));
    const b = farLook(new Map([[3, 2], [2, 5], [1, 5]]));
    expect(Array.from(a.table)).toEqual(Array.from(b.table));
  });
});

describe("farMean", () => {
  it("is the colour the eye makes of the look", () => {
    const look = farLook(new Map([[0x000000, 1], [0xc86440, 1]]));
    expect(farMean(look)).toEqual([100, 50, 32]);
  });
});

describe("farSlot", () => {
  it("picks the same slot for a screen pixel every time it is asked", () => {
    expect(farSlot(17, 5)).toBe(farSlot(17, 5));
  });

  it("stays in the table", () => {
    for (let y = 0; y < 40; y += 1) {
      for (let x = 0; x < 320; x += 1) {
        const slot = farSlot(x, y);
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThan(FAR_LEVELS);
      }
    }
  });

  it("spreads over every slot evenly enough that a look's shares are what the screen shows", () => {
    const hits = new Array<number>(FAR_LEVELS).fill(0);
    const width = 320;
    const height = 24;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        hits[farSlot(x, y)] = (hits[farSlot(x, y)] ?? 0) + 1;
      }
    }
    const expected = (width * height) / FAR_LEVELS;
    expect(Math.min(...hits)).toBeGreaterThan(expected * 0.6);
    expect(Math.max(...hits)).toBeLessThan(expected * 1.4);
  });
});
