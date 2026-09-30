import { describe, expect, it } from "vitest";

import { bufferPixel } from "./pixel-buffer";
import {
  bakePose,
  bakeScaled,
  lightKey,
  outlineCloud,
  pointSample,
  quantizeLight,
  settleAt,
  WIND_LEVELS,
  windLevelIndex,
} from "./scenery-bake";
import { PLACED_SPECIES } from "./scenery-features";
import { findSpecies } from "./trees";

const NOON = quantizeLight({ x: -0.6, y: -0.8 }, 0.9);

describe("quantizing the light", () => {
  it("snaps nearby directions to one key and distant ones to another", () => {
    const a = quantizeLight({ x: -0.6, y: -0.8 }, 0.71);
    const b = quantizeLight({ x: -0.61, y: -0.79 }, 0.69);
    const c = quantizeLight({ x: 0.8, y: -0.6 }, 0.7);
    expect(lightKey(a)).toBe(lightKey(b));
    expect(lightKey(a)).not.toBe(lightKey(c));
  });

  it("returns a unit direction and clamps the sun's height", () => {
    const light = quantizeLight({ x: 3, y: -4 }, 0.01);
    expect(Math.hypot(light.light.x, light.light.y)).toBeCloseTo(1, 6);
    expect(light.elevation).toBe(0.2);
  });
});

describe("wind levels", () => {
  it("are symmetric about a level at rest", () => {
    expect(WIND_LEVELS[windLevelIndex(0)]).toBe(0);
    expect(WIND_LEVELS).toEqual([...WIND_LEVELS].map((level) => 0 - level + 0).reverse().map((level) => level + 0));
  });

  it("pick the nearest level and clamp past the ends", () => {
    expect(windLevelIndex(9)).toBe(WIND_LEVELS.length - 1);
    expect(windLevelIndex(-9)).toBe(0);
    expect(WIND_LEVELS[windLevelIndex(0.3)]).toBe(0.35);
  });
});

describe("baking a pose", () => {
  it("bakes every placed species to a non-empty body with its foot inside the buffer", () => {
    for (const id of PLACED_SPECIES) {
      const species = findSpecies(id);
      expect(species, id).toBeDefined();
      const instance = species!.create(1234);
      settleAt(instance, 0, NOON, 200);
      const pose = bakePose(instance, NOON);
      expect(pose.body.buffer.width, id).toBeGreaterThan(4);
      expect(pose.body.originY, id).toBeGreaterThan(0);
      expect(pose.body.originY, id).toBeLessThanOrEqual(pose.body.buffer.height);
    }
  });

  it("leans a swaying tree further under a harder wind", () => {
    const species = findSpecies("sdf-crown")!;
    const still = species.create(77);
    settleAt(still, 0, NOON);
    const blown = species.create(77);
    settleAt(blown, 1.1, NOON);
    const rest = bakePose(still, NOON);
    const lean = bakePose(blown, NOON);
    const restCentre = rest.body.buffer.width / 2 - rest.body.originX;
    const leanCentre = lean.body.buffer.width / 2 - lean.body.originX;
    expect(leanCentre).toBeGreaterThan(restCentre);
  });

  it("casts a sheer shadow below the foot", () => {
    const instance = findSpecies("sdf-crown")!.create(9);
    const pose = bakePose(instance, NOON);
    expect(pose.shadow).not.toBeNull();
    const shadow = pose.shadow!;
    let opaque = 0;
    for (let y = 0; y < shadow.buffer.height; y += 1) {
      for (let x = 0; x < shadow.buffer.width; x += 1) {
        const alpha = bufferPixel(shadow.buffer, x, y)[3];
        if (alpha === 255) {
          opaque += 1;
        }
      }
    }
    expect(opaque).toBe(0);
  });

  it("is deterministic", () => {
    const one = findSpecies("oak-recursive")!.create(5);
    const two = findSpecies("oak-recursive")!.create(5);
    settleAt(one, 0.7, NOON, 400);
    settleAt(two, 0.7, NOON, 400);
    expect(bakePose(one, NOON).body.buffer.data).toEqual(bakePose(two, NOON).body.buffer.data);
  });
});

describe("the outline", () => {
  const blob = [
    { x: 0, y: -2, ink: "leaf-4" as const },
    { x: 1, y: -2, ink: "leaf-3" as const },
    { x: 0, y: -1, ink: "bark-2" as const },
  ];

  it("rims each material in its own darkest step, under the body", () => {
    const outlined = outlineCloud(blob, { x: 0, y: -1 });
    const rim = outlined.slice(0, outlined.length - blob.length);
    expect(rim).toContainEqual({ x: -1, y: -2, ink: "leaf-0" });
    expect(rim).toContainEqual({ x: -1, y: -1, ink: "bark-0" });
    expect(outlined.slice(-blob.length)).toEqual(blob);
  });

  it("leaves the lit side open and never outlines below the ground", () => {
    const rim = outlineCloud(blob, { x: 0, y: -1 }).slice(0, -blob.length);
    expect(rim.some((pixel) => pixel.y === -3)).toBe(false);
    expect(rim.some((pixel) => pixel.y > 0)).toBe(false);
  });

  it("does not outline accents or shadows", () => {
    expect(outlineCloud([{ x: 0, y: -1, ink: "petal-0" }], { x: 0, y: -1 })).toHaveLength(1);
  });
});

describe("baking for the horizon", () => {
  it("shrinks a volume body by re-sampling its field", () => {
    const instance = findSpecies("sdf-crown")!.create(3);
    const full = bakePose(instance, NOON).body;
    const far = bakeScaled(instance, NOON, 0.4);
    expect(far.buffer.width).toBeLessThan(full.buffer.width * 0.6);
    expect(far.buffer.height).toBeLessThan(full.buffer.height * 0.6);
  });

  it("point-samples a cloud about its foot", () => {
    const cloud = [
      { x: -4, y: -8, ink: "bark-2" as const },
      { x: 4, y: 0, ink: "bark-3" as const },
    ];
    expect(pointSample(cloud, 1)).toBe(cloud);
    const half = pointSample(cloud, 0.5);
    expect(half).toContainEqual({ x: -2, y: -4, ink: "bark-2" });
    expect(half).toContainEqual({ x: 2, y: 0, ink: "bark-3" });
    expect(pointSample([], 0.5)).toEqual([]);
  });
});
