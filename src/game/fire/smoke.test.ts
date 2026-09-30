import { describe, expect, it } from "vitest";

import { createPool, emit, stepParticles, type ParticleSpec } from "../fx/particles";
import { driftPuffs, MAX_PUFF_RADIUS, puffCloud, SMOKE_RAMP, type PuffStyle } from "./smoke";

const STILL: ParticleSpec = {
  ramp: SMOKE_RAMP,
  levelFrom: 0,
  levelTo: 0,
  lifeMs: [1000, 1000],
  speed: [0, 0],
  angle: [0, 0],
};

const STYLE: PuffStyle = { from: 1, to: 5, density: 1.2 };

function extent(cloud: ReturnType<typeof puffCloud>): number {
  return Math.max(...cloud.map((pixel) => Math.abs(pixel.x)));
}

describe("puffs", () => {
  it("draws nothing for an empty pool", () => {
    expect(puffCloud(createPool(4, 1), STYLE)).toEqual([]);
  });

  it("grows as it ages, and never past the cap", () => {
    const pool = createPool(1, 1);
    emit(pool, STILL, 1, 0, 0);
    stepParticles(pool, 30);
    const young = extent(puffCloud(pool, STYLE));
    for (let spent = 0; spent < 600; spent += 50) {
      stepParticles(pool, 50);
    }
    expect(extent(puffCloud(pool, STYLE))).toBeGreaterThan(young);
    expect(extent(puffCloud(pool, { ...STYLE, to: 40 }))).toBeLessThanOrEqual(MAX_PUFF_RADIUS);
  });

  it("inks only in smoke by default, and at the offset it is given", () => {
    const pool = createPool(1, 1);
    emit(pool, STILL, 1, 0, 0);
    const cloud = puffCloud(pool, STYLE, 100, 50);
    expect(cloud.length).toBeGreaterThan(0);
    expect(cloud.every((pixel) => SMOKE_RAMP.includes(pixel.ink))).toBe(true);
    expect(cloud.every((pixel) => Math.abs(pixel.x - 100) <= 2 && Math.abs(pixel.y - 50) <= 2)).toBe(true);
  });

  it("drifts with the wind's sign, harder when older", () => {
    const pool = createPool(2, 1);
    emit(pool, STILL, 2, 0, 0);
    (pool.particles[1] as { ageMs: number }).ageMs = 900;
    driftPuffs(pool, 20, 1);
    const [young, old] = pool.particles;
    expect(young?.x).toBeGreaterThan(0);
    expect(old?.x).toBeGreaterThan(young?.x ?? 0);
    driftPuffs(pool, 20, -3);
    expect(young?.x).toBeLessThan(0);
  });
});
