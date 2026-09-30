import { describe, expect, it } from "vitest";

import { createPool, liveCount, particleCloud, stepParticles } from "../fx/particles";
import { SLIME_INKS } from "./slime-palette";
import { emitDeathGoo, emitFlame, emitHitGoo, emitLanding, shiftPool } from "./slime-fx";

describe("slime effects", () => {
  it("spray goo in the variant's own inks", () => {
    const pool = createPool(40, 1);
    emitDeathGoo(pool, "frost");
    stepParticles(pool, 16);
    const inks = new Set(SLIME_INKS.frost.goo);
    const cloud = particleCloud(pool);
    expect(cloud.length).toBeGreaterThan(0);
    expect(cloud.every((pixel) => inks.has(pixel.ink))).toBe(true);
  });

  it("throw hit goo the way the blow pushed", () => {
    const meanX = (pushX: number): number => {
      const pool = createPool(20, 3);
      emitHitGoo(pool, "green", pushX, 0);
      stepParticles(pool, 150);
      const live = pool.particles.filter((particle) => particle.active);
      return live.reduce((sum, particle) => sum + particle.x, 0) / Math.max(live.length, 1);
    };
    expect(meanX(5)).toBeGreaterThan(meanX(-5));
  });

  it("land droplets on the ground rather than letting them fall forever", () => {
    const pool = createPool(40, 5);
    emitDeathGoo(pool, "green");
    stepParticles(pool, 150);
    stepParticles(pool, 150);
    for (const particle of pool.particles) {
      if (particle.active) {
        expect(particle.y).toBeLessThanOrEqual(4);
      }
    }
  });

  it("puff and splat on a landing, and all of it dies away", () => {
    const pool = createPool(40, 7);
    emitLanding(pool, "green");
    emitFlame(pool, 10);
    expect(liveCount(pool)).toBe(10);
    for (let t = 0; t < 2000; t += 50) {
      stepParticles(pool, 50);
    }
    expect(liveCount(pool)).toBe(0);
  });

  it("leave particles on the ground when the emitter moves", () => {
    const pool = createPool(10, 9);
    emitLanding(pool, "green");
    const before = pool.particles.map((particle) => particle.x);
    shiftPool(pool, 4, 0);
    pool.particles.forEach((particle, index) => {
      if (particle.active) {
        expect(particle.x).toBeCloseTo((before[index] ?? 0) - 4, 9);
      }
    });
  });
});
