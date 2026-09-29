import { describe, expect, it } from "vitest";

import { createWangTable, MIDDLE_NODE, nodeColour, wangField } from "./wang";

const table = createWangTable(16, 12, 0x1234, [{ scaleX: 5, scaleY: 4, octaves: 2 }]);

/** Largest step between horizontally adjacent pixels inside one tile. */
function maxInternalStep(field: Float32Array): number {
  let worst = 0;
  for (let y = 0; y < 12; y += 1) {
    for (let x = 0; x < 15; x += 1) {
      worst = Math.max(worst, Math.abs((field[y * 16 + x + 1] ?? 0) - (field[y * 16 + x] ?? 0)));
    }
  }
  return worst;
}

describe("the Wang tile field", () => {
  it("is deterministic and stays near the unit range", () => {
    const a = wangField(table, 0, 0b101010101, 3);
    const b = wangField(table, 0, 0b101010101, 3);
    expect([...a]).toEqual([...b]);
    for (const value of a) {
      expect(value).toBeGreaterThan(-0.2);
      expect(value).toBeLessThan(1.2);
    }
  });

  it("changes with the colours, so variants are genuinely different", () => {
    const a = wangField(table, 0, 0, 0);
    const b = wangField(table, 0, 0b111101111, 5);
    expect([...a]).not.toEqual([...b]);
  });

  it("meets a neighbour without a seam whatever the private nodes are", () => {
    // Cell A's east column (nodes 2, 5, 8) is cell B's west column (0, 3, 6).
    // Everything else - the other edges, the corners away from the join, the
    // middles - is chosen to disagree as hard as possible.
    for (let trial = 0; trial < 16; trial += 1) {
      const shared = [trial & 1, (trial >> 1) & 1, (trial >> 2) & 1];
      const colourA = (shared[0]! << 2) | (shared[1]! << 5) | (shared[2]! << 8) | 0b001001011;
      const colourB = shared[0]! | (shared[1]! << 3) | (shared[2]! << 6) | 0b110110100;
      const a = wangField(table, 0, colourA, trial % 8);
      const b = wangField(table, 0, colourB, (trial + 3) % 8);
      const inside = Math.max(maxInternalStep(a), maxInternalStep(b));
      for (let y = 0; y < 12; y += 1) {
        const jump = Math.abs((a[y * 16 + 15] ?? 0) - (b[y * 16] ?? 0));
        expect(jump).toBeLessThanOrEqual(inside * 1.25 + 1e-6);
      }
    }
  });

  it("reads the middle colour from its own argument and the rest from the bits", () => {
    expect(nodeColour(0b1111, 6, MIDDLE_NODE)).toBe(6);
    expect(nodeColour(0b0100, 6, 2)).toBe(1);
    expect(nodeColour(0b0100, 6, 1)).toBe(0);
  });
});
