import { describe, expect, it } from "vitest";

import { HERO_EQUIPPED } from "../models";
import { contactPool, heroShadow } from "./hero-shadow";
import { heroFigure } from "./hero-figure";

const FIGURE = heroFigure(HERO_EQUIPPED.basePose).cloud;

describe("contactPool", () => {
  it("is a small dark ellipse on the ground under the boots", () => {
    const pool = contactPool();
    expect(pool.length).toBeGreaterThan(10);
    expect(pool.every((p) => Math.abs(p.x) <= 5 && p.y >= -1 && p.y <= 2)).toBe(true);
    expect(pool.every((p) => p.ink === "shadow" || p.ink === "shadow-soft")).toBe(true);
  });
});

describe("heroShadow", () => {
  it("falls away from the light: a sun on the left throws it right", () => {
    const left = heroShadow(FIGURE, { light: { x: -0.9, y: -0.4 }, elevation: 0.25 });
    const right = heroShadow(FIGURE, { light: { x: 0.9, y: -0.4 }, elevation: 0.25 });
    const mean = (cloud: typeof left) => cloud.reduce((sum, p) => sum + p.x, 0) / cloud.length;
    expect(mean(left)).toBeGreaterThan(mean(right));
  });

  it("is longer at dusk than at noon", () => {
    const width = (cloud: ReturnType<typeof heroShadow>) =>
      Math.max(...cloud.map((p) => p.x)) - Math.min(...cloud.map((p) => p.x));
    const noon = heroShadow(FIGURE, { light: { x: -0.3, y: -0.95 }, elevation: 1 });
    const dusk = heroShadow(FIGURE, { light: { x: -0.95, y: -0.3 }, elevation: 0.2 });
    expect(width(dusk)).toBeGreaterThan(width(noon));
  });

  it("lies on the ground and never paints a pixel twice", () => {
    const shadow = heroShadow(FIGURE, { light: { x: -0.6, y: -0.8 }, elevation: 0.5 });
    expect(shadow.every((p) => p.y >= -1)).toBe(true);
    const keys = shadow.map((p) => `${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
