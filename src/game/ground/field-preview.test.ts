import { describe, expect, it } from "vitest";

import { TILE_DEPTH, TILE_WIDTH, WALL_RISE } from "../projection";
import { composeField, demoTerrain, syntheticSample } from "./field-preview";
import { DIRT, GRASS, ROCK } from "./ground-sample";

describe("the lab's composed meadow", () => {
  const sample = syntheticSample(10, 7, demoTerrain);

  it("holds grass, path and rock, so one picture shows all three", () => {
    const codes = new Set(sample.terrain);
    expect(codes).toEqual(new Set([GRASS, DIRT, ROCK]));
  });

  it("is the grid plus a wall's rise of headroom, fully painted", () => {
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
