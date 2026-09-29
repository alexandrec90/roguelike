import { describe, expect, it } from "vitest";

import { strikeHits, strikePush, type Strike } from "./combat";

const BLAST: Strike = { at: { x: 0, y: 2 }, radius: 1.5, damage: 2, element: "fire", force: 6 };

describe("a strike", () => {
  it("hits inside its reach and misses outside", () => {
    expect(strikeHits(BLAST, { x: 0, y: 2 })).toBe(true);
    expect(strikeHits(BLAST, { x: 1, y: 3 })).toBe(true);
    expect(strikeHits(BLAST, { x: 2, y: 2 })).toBe(false);
  });

  it("pushes radially, weaker at the rim", () => {
    const near = strikePush(BLAST, { x: 0.3, y: 2 });
    const far = strikePush(BLAST, { x: 1.4, y: 2 });
    expect(near.x).toBeGreaterThan(0);
    expect(near.y).toBeCloseTo(0, 6);
    expect(Math.hypot(far.x, far.y)).toBeLessThan(Math.hypot(near.x, near.y));
  });

  it("uses its own push when it has one, and never divides by zero at the centre", () => {
    const cut: Strike = { ...BLAST, push: { x: 0, y: 5 } };
    expect(strikePush(cut, { x: 1, y: 1 })).toEqual({ x: 0, y: 5 });
    const centre = strikePush(BLAST, BLAST.at);
    expect(Number.isFinite(centre.x) && Number.isFinite(centre.y)).toBe(true);
  });
});
