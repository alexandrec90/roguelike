import { describe, expect, it } from "vitest";

import { createPool, liveCount, particleCloud, stepParticles } from "../fx/particles";
import { cloudBounds } from "../ink";
import { BOLT_CORE, BOLT_GLOW, boltCloud } from "./bolt";
import { mistCloud } from "./mist";
import { emitSplash, SPLASH_COUNTS } from "./splash";

describe("emitSplash", () => {
  it("throws a crown sized by how near the drop was", () => {
    SPLASH_COUNTS.forEach((count, sheet) => {
      const pool = createPool(16, 1);
      emitSplash(pool, sheet as 0 | 1 | 2, 10, 10);
      expect(liveCount(pool)).toBe(count);
    });
    expect(SPLASH_COUNTS[2]).toBeGreaterThan(SPLASH_COUNTS[0]);
  });

  it("goes up first, stays small, and is gone within a fifth of a second or so", () => {
    const pool = createPool(16, 4);
    emitSplash(pool, 2, 20, 20);
    stepParticles(pool, 60);
    const early = particleCloud(pool);
    expect(early.some((pixel) => pixel.y < 19)).toBe(true);
    const bounds = cloudBounds(early);
    expect(bounds === null || bounds.right - bounds.left <= 10).toBe(true);
    for (let ms = 60; ms < 300; ms += 16) {
      stepParticles(pool, 16);
    }
    expect(liveCount(pool)).toBe(0);
  });

  it("is deterministic per pool seed", () => {
    const a = createPool(8, 9);
    const b = createPool(8, 9);
    emitSplash(a, 1, 0, 0);
    emitSplash(b, 1, 0, 0);
    stepParticles(a, 50);
    stepParticles(b, 50);
    expect(particleCloud(a)).toEqual(particleCloud(b));
  });
});

describe("boltCloud", () => {
  it("is deterministic per seed and differs across seeds", () => {
    expect(boltCloud(5, 40, 0, 30)).toEqual(boltCloud(5, 40, 0, 30));
    expect(boltCloud(5, 40, 0, 30)).not.toEqual(boltCloud(6, 40, 0, 30));
  });

  it("has an unbroken white core from the top to the strike point", () => {
    const core = boltCloud(5, 40, 0, 30).filter((pixel) => pixel.ink === BOLT_CORE);
    const rows = new Set(core.map((pixel) => pixel.y));
    for (let y = 0; y <= 30; y += 1) {
      expect(rows.has(y)).toBe(true);
    }
  });

  it("glows and branches: more than a line, and wider than the trunk alone", () => {
    const cloud = boltCloud(5, 40, 0, 30);
    const core = cloud.filter((pixel) => pixel.ink === BOLT_CORE);
    expect(cloud.some((pixel) => pixel.ink === BOLT_GLOW)).toBe(true);
    expect(cloud.length).toBeGreaterThan(core.length * 2);
  });

  it("loses its glow as it fades but keeps its core", () => {
    const bright = boltCloud(5, 40, 0, 30, 1);
    const faint = boltCloud(5, 40, 0, 30, 0.1);
    expect(faint.length).toBeLessThan(bright.length);
    const coreRows = new Set(faint.filter((pixel) => pixel.ink === BOLT_CORE).map((pixel) => pixel.y));
    expect(coreRows.size).toBe(31);
  });
});

describe("mistCloud", () => {
  it("is empty in a drizzle and fills a band by the horizon in a downpour", () => {
    expect(mistCloud(320, 14, 22, 0.3, 1)).toHaveLength(0);
    const mist = mistCloud(320, 14, 22, 1, 1);
    expect(mist.length).toBeGreaterThan(500);
    const bounds = cloudBounds(mist);
    expect(bounds?.top).toBeGreaterThan(0);
    expect(bounds?.bottom).toBeLessThan(60);
  });

  it("thickens with the rain and is a pure function", () => {
    expect(mistCloud(320, 14, 22, 0.6, 1).length).toBeLessThan(mistCloud(320, 14, 22, 1, 1).length);
    expect(mistCloud(100, 14, 22, 0.9, 0.2)).toEqual(mistCloud(100, 14, 22, 0.9, 0.2));
  });

  it("is drawn in sheer smoke, so what is behind it still shows", () => {
    for (const pixel of mistCloud(120, 14, 22, 1, 1)) {
      expect(pixel.ink.startsWith("smoke-")).toBe(true);
    }
  });
});
