import { describe, expect, it } from "vitest";

import { rasterizeSprite } from "./pixel-art";
import {
  createRippleField,
  resetRipples,
  rippleAlpha,
  rippleCloud,
  RIPPLE_LIFE_MS,
  RIPPLE_MAX_RADIUS,
  sampleRippleFrames,
  spawnRipple,
  stepRipples,
  type Ripple,
} from "./ripples";

describe("the ripple pool", () => {
  it("allocates up front, all idle, and rejects an empty pool", () => {
    expect(createRippleField(4).ripples).toHaveLength(4);
    expect(createRippleField(4).ripples.every((ripple) => !ripple.active)).toBe(true);
    expect(() => createRippleField(0)).toThrow(/positive integer/);
  });

  it("drops a spawn rather than growing when the pool is full", () => {
    const field = createRippleField(2);
    expect(spawnRipple(field, 1, 2)).toBe(true);
    expect(spawnRipple(field, 3, 4)).toBe(true);
    expect(spawnRipple(field, 5, 6)).toBe(false);
    expect(field.ripples).toHaveLength(2);
  });

  it("snaps a ring to whole pixels — water is drawn on the grid too", () => {
    const field = createRippleField(1);
    spawnRipple(field, 10.4, 20.6);
    expect(field.ripples[0]).toMatchObject({ x: 10, y: 21 });
  });

  it("retires a ring once it outlives its life, and frees the slot", () => {
    const field = createRippleField(1);
    spawnRipple(field, 0, 0);
    stepRipples(field, RIPPLE_LIFE_MS - 1);
    expect(field.ripples[0]?.active).toBe(true);
    stepRipples(field, 2);
    expect(field.ripples[0]?.active).toBe(false);
    expect(spawnRipple(field, 1, 1)).toBe(true);
  });

  it("resets to the opening state", () => {
    const field = createRippleField(2);
    spawnRipple(field, 4, 5);
    stepRipples(field, 100);
    resetRipples(field);
    expect(field.ripples).toEqual(createRippleField(2).ripples);
  });
});

describe("rippleCloud", () => {
  const ring = (ageMs: number): Ripple => ({
    active: true,
    x: 0,
    y: 0,
    ageMs,
    lifeMs: RIPPLE_LIFE_MS,
  });

  it("draws nothing for an idle slot", () => {
    expect(rippleCloud({ active: false, x: 0, y: 0, ageMs: 0, lifeMs: RIPPLE_LIFE_MS })).toEqual([]);
    expect(rippleAlpha({ active: false, x: 0, y: 0, ageMs: 0, lifeMs: RIPPLE_LIFE_MS })).toBe(0);
  });

  it("opens fast and slows, and never outgrows its cap", () => {
    const spread = (ageMs: number): number =>
      Math.max(...rippleCloud(ring(ageMs)).map((pixel) => Math.abs(pixel.x)));
    const early = spread(RIPPLE_LIFE_MS * 0.25);
    const middle = spread(RIPPLE_LIFE_MS * 0.5);
    const late = spread(RIPPLE_LIFE_MS * 0.99);
    expect(early).toBeLessThan(middle);
    expect(middle).toBeLessThan(late);
    // Eased: the first quarter of the life covers more than a linear share.
    expect(early / late).toBeGreaterThan(0.25);
    expect(late).toBeLessThanOrEqual(RIPPLE_MAX_RADIUS);
  });

  it("is a foreshortened ring with no gaps in it", () => {
    const cloud = rippleCloud(ring(RIPPLE_LIFE_MS * 0.9));
    const spreadX = Math.max(...cloud.map((pixel) => Math.abs(pixel.x)));
    const spreadY = Math.max(...cloud.map((pixel) => Math.abs(pixel.y)));
    expect(spreadY).toBeLessThan(spreadX);

    // Every row of the outline is continuous around the sweep: with both axes
    // swept, no step of the outline may jump more than a pixel.
    const rows = new Set(cloud.map((pixel) => pixel.y));
    for (let y = -spreadY; y <= spreadY; y += 1) {
      expect(rows.has(y)).toBe(true);
    }
  });

  it("splashes a bright centre only while the drop is still going in", () => {
    expect(rippleCloud(ring(0)).some((pixel) => pixel.ink === "bone")).toBe(true);
    expect(rippleCloud(ring(RIPPLE_LIFE_MS * 0.8)).some((pixel) => pixel.ink === "bone")).toBe(
      false,
    );
  });

  it("fades as it spreads", () => {
    expect(rippleAlpha(ring(0))).toBeCloseTo(1, 5);
    expect(rippleAlpha(ring(RIPPLE_LIFE_MS * 0.5))).toBeCloseTo(0.5, 5);
    expect(rippleAlpha(ring(RIPPLE_LIFE_MS))).toBeCloseTo(0, 5);
  });

  it("draws around wherever the drop landed", () => {
    const moved = rippleCloud({ active: true, x: 40, y: 70, ageMs: 100, lifeMs: RIPPLE_LIFE_MS });
    expect(moved.every((pixel) => Math.abs(pixel.x - 40) <= RIPPLE_MAX_RADIUS)).toBe(true);
    expect(moved.every((pixel) => Math.abs(pixel.y - 70) <= RIPPLE_MAX_RADIUS)).toBe(true);
  });
});

describe("the ripple lab frames", () => {
  it("bakes a ring's life into rasterizable, same-sized frames", () => {
    const frames = sampleRippleFrames(8);
    expect(frames).toHaveLength(8);
    const sizes = new Set(
      frames.map((frame) => {
        const raster = rasterizeSprite(frame);
        return `${raster.width}x${raster.height}`;
      }),
    );
    expect(sizes.size).toBe(1);
  });

  it("rejects a frame count that is not a positive whole number", () => {
    expect(() => sampleRippleFrames(1.5)).toThrow(/positive integer/);
  });
});
