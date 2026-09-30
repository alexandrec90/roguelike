import { describe, expect, it } from "vitest";

import { fireflies, FIREFLY_COUNT, moteCloud, moteLights, pollen, POLLEN_COUNT } from "./ambient-life";
import {
  CLOUD_DRIFT_PX,
  cloudDensity,
  cloudShadowsAt,
  cloudShadowTile,
  CLOUD_TILE_HEIGHT,
  CLOUD_TILE_WIDTH,
  tileOrigins,
} from "./cloud-shadow";
import { createOdometer, trackScroll } from "./odometer";
import { bufferPixel } from "./pixel-buffer";

const STILL = { x: 0, y: 0 };

describe("fireflies", () => {
  it("stay in by day and come out at night", () => {
    expect(fireflies(1000, 0.1, STILL)).toEqual([]);
    expect(fireflies(1000, 1, STILL)).toHaveLength(FIREFLY_COUNT);
  });

  it("blink, each on its own cycle, and light only while lit", () => {
    const flies = fireflies(1234, 1, STILL);
    const glows = new Set(flies.map((fly) => fly.glow.toFixed(2)));
    expect(glows.size).toBeGreaterThan(5);
    expect(moteCloud(flies).length).toBeLessThan(flies.length);
    for (const light of moteLights(flies)) {
      expect(light.radius).toBeGreaterThan(0);
    }
  });

  it("are carried by the ground and reproduce for a time", () => {
    const here = fireflies(500, 1, STILL);
    const moved = fireflies(500, 1, { x: 3, y: 0 });
    expect(fireflies(500, 1, STILL)).toEqual(here);
    expect(moved.some((fly, index) => fly.x !== here[index]!.x)).toBe(true);
  });
});

describe("pollen", () => {
  it("drifts by day only", () => {
    expect(pollen(0, 0.2, 0, STILL)).toEqual([]);
    expect(pollen(0, 1, 0, STILL)).toHaveLength(POLLEN_COUNT);
  });
});

describe("cloud shadows", () => {
  it("tile seamlessly", () => {
    for (let y = 0; y < CLOUD_TILE_HEIGHT; y += 17) {
      expect(cloudDensity(0, y, 3)).toBeCloseTo(cloudDensity(CLOUD_TILE_WIDTH, y, 3), 9);
    }
    for (let x = 0; x < CLOUD_TILE_WIDTH; x += 23) {
      expect(cloudDensity(x, 0, 3)).toBeCloseTo(cloudDensity(x, CLOUD_TILE_HEIGHT, 3), 9);
    }
  });

  it("are mostly sunlight, with some shade, never black", () => {
    const tile = cloudShadowTile(5);
    let shaded = 0;
    let darkest = 255;
    for (let y = 0; y < CLOUD_TILE_HEIGHT; y += 2) {
      for (let x = 0; x < CLOUD_TILE_WIDTH; x += 2) {
        const value = bufferPixel(tile, x, y)[0];
        darkest = Math.min(darkest, value);
        shaded += value < 250 ? 1 : 0;
      }
    }
    const samples = (CLOUD_TILE_WIDTH / 2) * (CLOUD_TILE_HEIGHT / 2);
    expect(shaded / samples).toBeGreaterThan(0.1);
    expect(shaded / samples).toBeLessThan(0.7);
    expect(darkest).toBeGreaterThan(150);
  });

  it("fall only by day, drift with the wind, and ride the ground", () => {
    const noon = cloudShadowsAt({ x: 0, y: 0 }, 0, { overcast: 0.35, daylight: 1 });
    expect(noon.strength).toBeGreaterThan(0.8);
    expect(cloudShadowsAt({ x: 0, y: 0 }, 0, { overcast: 0.35, daylight: 0 }).strength).toBe(0);
    const later = cloudShadowsAt({ x: 10, y: 4 }, 2000, { overcast: 0.35, daylight: 1 });
    expect(later.x).toBe(10 + 2 * CLOUD_DRIFT_PX);
    expect(later.y).toBeGreaterThan(4);
  });

  it("covers the view with tiles whatever the offset", () => {
    for (const offset of [0, 17, -250, 1000]) {
      const origins = tileOrigins(offset, offset * 0.5, 328, 188);
      expect(origins.some((origin) => origin.x <= 0 && origin.y <= 0)).toBe(true);
      expect(origins.some((origin) => origin.x + CLOUD_TILE_WIDTH >= 328)).toBe(true);
    }
  });
});

describe("the odometer", () => {
  it("accumulates a walk across step boundaries", () => {
    const odometer = createOdometer();
    const first = {};
    const second = {};
    trackScroll(odometer, { x: 0, y: 0 }, first);
    trackScroll(odometer, { x: 0, y: 0.5 }, first);
    trackScroll(odometer, { x: 0, y: 0 }, second);
    // One whole tile forward: the ground slid down the screen by its depth.
    expect(odometer.y).toBeCloseTo(12, 6);
    trackScroll(odometer, { x: 0.25, y: 0 }, second);
    expect(odometer.x).toBeCloseTo(-4, 6);
  });
});
