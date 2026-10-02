import { describe, expect, it } from "vitest";

import { TILE_DEPTH, TILE_WIDTH, WALL_RISE } from "../projection";
import { composeField, demoTerrain, syntheticSample } from "./field-preview";
import { DIRT, GRASS } from "./ground-sample";

describe("the lab's composed meadow", () => {
  const sample = syntheticSample(10, 7, demoTerrain);

  it("holds grass and path, so one picture shows both", () => {
    const codes = new Set(sample.terrain);
    expect(codes).toEqual(new Set([GRASS, DIRT]));
  });

  it("is the grid plus headroom for the far row's grass, fully painted", () => {
    const field = composeField(sample, 0);
    expect(field.width).toBe(10 * TILE_WIDTH);
    expect(field.height).toBe(7 * TILE_DEPTH + WALL_RISE);
    const ground = field.inks.slice(WALL_RISE * field.width);
    expect(ground.every((ink) => ink !== null)).toBe(true);
  });

  it("is a function of time only through the wind", () => {
    expect(composeField(sample, 900).inks).toEqual(composeField(sample, 900).inks);
    expect(composeField(sample, 0).inks).not.toEqual(composeField(sample, 2400).inks);
  });
});
