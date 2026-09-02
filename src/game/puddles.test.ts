import { describe, expect, it } from "vitest";

import type { PixelCloud } from "./ink";
import { rasterizeSprite } from "./pixel-art";
import { DEPTH_RATIO } from "./projection";
import {
  clipToPuddle,
  createPuddle,
  puddleGlints,
  puddleHolds,
  puddleReflection,
  puddleSurface,
  rainImpact,
  samplePuddleFrames,
  type Puddle,
} from "./puddles";
import { rippleCloud, RIPPLE_LIFE_MS } from "./ripples";

function puddle(overrides: Partial<Parameters<typeof createPuddle>[0]> = {}): Puddle {
  return createPuddle({ id: "test", centerX: 60, centerY: 90, radius: 10, seed: 0x51bd, ...overrides });
}

/** A 1-wide column standing 8 pixels tall, foot at (0, 0) in cloud space. */
function column(ink: PixelCloud[number]["ink"] = "bone"): PixelCloud {
  return Array.from({ length: 8 }, (_unused, index) => ({ x: 0, y: -index, ink }));
}

describe("createPuddle", () => {
  it("is deterministic per seed and different across seeds", () => {
    expect(puddle().water).toEqual(puddle().water);
    expect(puddle({ seed: 1 }).water).not.toEqual(puddle({ seed: 2 }).water);
  });

  it("lies on the ground: the depth half-axis is foreshortened, never the art", () => {
    const water = puddle({ radius: 12 });
    expect(water.radiusX).toBe(12);
    // Foreshortened at least as hard as the camera pitch demands — water
    // spreads, so it may be flatter still, but never rounder.
    expect(water.radiusY).toBeLessThanOrEqual(Math.round(12 * DEPTH_RATIO));
    expect(water.radiusY).toBeGreaterThan(0);
  });

  it("refuses a puddle too small to read as one", () => {
    expect(() => puddle({ radius: 1 })).toThrow(/radius/);
  });

  it("holds a solid body around its centre", () => {
    const water = puddle();
    expect(puddleHolds(water, water.centerX, water.centerY)).toBe(true);
    expect(puddleHolds(water, water.centerX, water.centerY - water.radiusY * 3)).toBe(false);
    // No holes: every row between the extremes has water in it.
    const rows = new Set(water.water.map((pixel) => pixel.y));
    const top = Math.min(...rows);
    const bottom = Math.max(...rows);
    for (let y = top; y <= bottom; y += 1) {
      expect(rows.has(y)).toBe(true);
    }
  });

  it("gives a lobed outline rather than a bare ellipse", () => {
    const water = puddle();
    const widthAt = (y: number): number => {
      const row = water.water.filter((pixel) => pixel.y === y);
      return row.length === 0 ? 0 : Math.max(...row.map((p) => p.x)) - Math.min(...row.map((p) => p.x));
    };
    // A pure ellipse is symmetric about its centre row; a lobed one is not.
    expect(widthAt(water.centerY - 2)).not.toBe(widthAt(water.centerY + 2));
  });

  it("marks exactly the pixels with a dry neighbour as rim", () => {
    const water = puddle();
    const rimKeys = new Set(water.rim.map((pixel) => `${pixel.x},${pixel.y}`));
    for (const pixel of water.water) {
      const exposed =
        !puddleHolds(water, pixel.x - 1, pixel.y) ||
        !puddleHolds(water, pixel.x + 1, pixel.y) ||
        !puddleHolds(water, pixel.x, pixel.y - 1) ||
        !puddleHolds(water, pixel.x, pixel.y + 1);
      expect(rimKeys.has(`${pixel.x},${pixel.y}`)).toBe(exposed);
    }
    expect(water.rim.length).toBeLessThan(water.water.length);
  });
});

describe("clipToPuddle", () => {
  it("keeps what is over water and drops what is not", () => {
    const water = puddle();
    const cloud: PixelCloud = [
      { x: water.centerX, y: water.centerY, ink: "ice" },
      { x: water.centerX + 400, y: water.centerY, ink: "ice" },
    ];
    expect(clipToPuddle(water, cloud)).toEqual([cloud[0]]);
  });
});

describe("puddleSurface", () => {
  it("fills the body with the translucent water ink", () => {
    const water = puddle();
    const surface = puddleSurface(water);
    const body = surface.filter((pixel) => pixel.ink === "water");
    expect(body).toHaveLength(water.water.length);
  });

  it("lights the far lip and leaves the near edge dark", () => {
    const water = puddle();
    const surface = puddleSurface(water);
    const steel = surface.filter((pixel) => pixel.ink === "steel");
    const deep = surface.filter((pixel) => pixel.ink === "deep");
    expect(steel.length).toBeGreaterThan(0);
    expect(deep.length).toBeGreaterThan(0);
    // Far is up the screen: every lit lip pixel is above every dark one.
    expect(Math.max(...steel.map((pixel) => pixel.y))).toBeLessThan(
      Math.max(...deep.map((pixel) => pixel.y)),
    );
  });

  it("does not move on its own — the scene stamps it once", () => {
    const water = puddle();
    expect(puddleSurface(water)).toEqual(puddleSurface(water));
  });
});

describe("puddleGlints", () => {
  it("is a pure function of time, and stays on the water", () => {
    const water = puddle();
    expect(puddleGlints(water, 1234)).toEqual(puddleGlints(water, 1234));
    for (const pixel of puddleGlints(water, 1234)) {
      expect(puddleHolds(water, pixel.x, pixel.y)).toBe(true);
    }
  });

  it("slides sideways as time passes", () => {
    const water = puddle();
    const xs = (ms: number): string => puddleGlints(water, ms).map((pixel) => pixel.x).join(",");
    const seen = new Set([xs(0), xs(700), xs(1400), xs(2100)]);
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("puddleReflection", () => {
  it("hangs below the foot and keeps the reflected thing's own inks", () => {
    const water = puddle();
    const reflection = puddleReflection(
      water,
      column("amber"),
      water.centerX,
      water.centerY - 6,
      0,
    );
    expect(reflection.length).toBeGreaterThan(0);
    expect(reflection.every((pixel) => pixel.ink === "amber")).toBe(true);
    expect(reflection.every((pixel) => pixel.y > water.centerY - 6)).toBe(true);
  });

  it("never paints outside the water it belongs to", () => {
    const water = puddle();
    const wide: PixelCloud = Array.from({ length: 60 }, (_unused, index) => ({
      x: index - 30,
      y: -1,
      ink: "bone" as const,
    }));
    for (const pixel of puddleReflection(water, wide, water.centerX, water.centerY, 0)) {
      expect(puddleHolds(water, pixel.x, pixel.y)).toBe(true);
    }
  });

  it("wobbles with time instead of standing as a rigid mirror", () => {
    const water = puddle({ radius: 14 });
    const shape = (ms: number): string =>
      puddleReflection(water, column(), water.centerX, water.centerY - 8, ms)
        .map((pixel) => `${pixel.x}:${pixel.y}`)
        .join("|");
    expect(new Set([shape(0), shape(400), shape(850), shape(1300)]).size).toBeGreaterThan(1);
  });
});

describe("the lab frames", () => {
  it("bakes a puddle into rasterizable, same-sized frames", () => {
    const frames = samplePuddleFrames(8);
    expect(frames).toHaveLength(8);
    const sizes = new Set(
      frames.map((frame) => {
        const raster = rasterizeSprite(frame);
        return `${raster.width}x${raster.height}`;
      }),
    );
    expect(sizes.size).toBe(1);
  });

  it("keeps the whole puddle inside its frame", () => {
    const [first] = samplePuddleFrames(1);
    if (first === undefined) {
      throw new Error("unreachable");
    }
    // Nothing lit is pushed against an edge, so nothing was silently clipped.
    const rows = first.rows;
    const dry = (row: string): boolean => [...row].every((glyph) => glyph === ".");
    expect(dry(rows[0] as string)).toBe(true);
    expect(dry(rows[rows.length - 1] as string)).toBe(true);
    expect(rows.every((row) => row.startsWith(".") && row.endsWith("."))).toBe(true);
  });

  it("rejects a frame count that is not a positive whole number", () => {
    expect(() => samplePuddleFrames(0)).toThrow(/positive integer/);
    expect(() => samplePuddleFrames(1.5)).toThrow(/positive integer/);
  });
});

describe("rainImpact", () => {
  const pool = puddle();
  const slant = (steps: number): [number, number, number, number] => [
    pool.centerX - 4,
    pool.centerY - pool.radiusY - 12,
    pool.centerX - 4 + steps * 0.4,
    pool.centerY - pool.radiusY - 12 + steps,
  ];

  it("reports nothing for a segment that misses every puddle", () => {
    expect(rainImpact([pool], 5, 5, 6, 20)).toBeNull();
    expect(rainImpact([], ...slant(40))).toBeNull();
  });

  it("catches a puddle the segment jumped clean over in one step", () => {
    // A whole puddle inside a single frame's travel: the endpoints are both
    // dry, so anything testing only the drop's current pixel misses it.
    const above = pool.centerY - pool.radiusY * 2 - 4;
    const below = pool.centerY + pool.radiusY * 2 + 4;
    expect(puddleHolds(pool, pool.centerX, above)).toBe(false);
    expect(puddleHolds(pool, pool.centerX, below)).toBe(false);
    expect(rainImpact([pool], pool.centerX, above, pool.centerX, below)).not.toBeNull();
  });

  it("lands the drop in the water rather than on the far rim it entered by", () => {
    // The regression. A downward segment always touches the *back* edge first,
    // so a ring opened there has most of itself outside the puddle and is
    // clipped to almost nothing — which is exactly what the scene showed.
    const impact = rainImpact([pool], ...slant(40));
    expect(impact).not.toBeNull();
    if (impact === null) {
      throw new Error("unreachable");
    }
    expect(impact.puddle.id).toBe(pool.id);
    expect(puddleHolds(pool, impact.x, impact.y)).toBe(true);
    expect(pool.rim.some((pixel) => pixel.x === impact.x && pixel.y === impact.y)).toBe(false);

    // And the ring it opens is mostly water, at every age of its life.
    for (const age of [0, RIPPLE_LIFE_MS / 2, RIPPLE_LIFE_MS - 1]) {
      const ring = rippleCloud({
        active: true,
        x: impact.x,
        y: impact.y,
        ageMs: age,
        lifeMs: RIPPLE_LIFE_MS,
      });
      const wet = ring.filter((pixel) => puddleHolds(pool, pixel.x, pixel.y));
      expect(wet.length / ring.length).toBeGreaterThan(0.5);
    }
  });

  it("is a pure function of the segment and the seed", () => {
    expect(rainImpact([pool], ...slant(40))).toEqual(rainImpact([pool], ...slant(40)));
    const other = puddle({ seed: 0x2c41 });
    expect(rainImpact([other], ...slant(40))?.y).not.toBe(rainImpact([pool], ...slant(40))?.y);
  });
});
