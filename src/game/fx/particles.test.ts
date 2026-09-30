import { describe, expect, it } from "vitest";

import {
  clearPool,
  createPool,
  emit,
  liveCount,
  MAX_PARTICLE_STEP_MS,
  particleCloud,
  stepParticles,
  type ParticleSpec,
} from "./particles";
import { INK_RAMPS } from "../shading";

const SPARK: ParticleSpec = {
  ramp: INK_RAMPS.fire,
  levelFrom: 1,
  levelTo: 0.2,
  lifeMs: [300, 300],
  speed: [0.05, 0.05],
  angle: [-Math.PI / 2, -Math.PI / 2],
  fade: 0,
};

describe("a particle pool", () => {
  it("is allocated once, at a fixed size", () => {
    const pool = createPool(8, 1);
    expect(pool.particles).toHaveLength(8);
    expect(liveCount(pool)).toBe(0);
    expect(() => createPool(0, 1)).toThrow(/positive integer/);
  });

  it("recycles the oldest particle rather than growing", () => {
    const pool = createPool(3, 1);
    emit(pool, SPARK, 3, 0, 0);
    stepParticles(pool, 100);
    emit(pool, SPARK, 1, 50, 50);
    expect(pool.particles).toHaveLength(3);
    expect(liveCount(pool)).toBe(3);
    expect(pool.particles.some((particle) => particle.x === 50)).toBe(true);
  });

  it("moves particles by their velocity and retires them at the end of life", () => {
    const pool = createPool(1, 1);
    emit(pool, SPARK, 1, 0, 0);
    stepParticles(pool, 100);
    const particle = pool.particles[0]!;
    expect(particle.y).toBeCloseTo(-5, 5);
    stepParticles(pool, 150);
    stepParticles(pool, 100);
    expect(liveCount(pool)).toBe(0);
  });

  it("applies gravity and stops falling things at the floor", () => {
    const pool = createPool(1, 1);
    emit(pool, { ...SPARK, gravity: 0.001, floor: 2, lifeMs: [5000, 5000] }, 1, 0, 0);
    for (let index = 0; index < 60; index += 1) {
      stepParticles(pool, 16);
    }
    expect(pool.particles[0]!.y).toBe(2);
  });

  it("clamps a long delta rather than teleporting", () => {
    const pool = createPool(1, 1);
    emit(pool, { ...SPARK, lifeMs: [60_000, 60_000] }, 1, 0, 0);
    stepParticles(pool, 10_000);
    expect(pool.particles[0]!.ageMs).toBe(MAX_PARTICLE_STEP_MS * 3);
  });

  it("is deterministic for a seed and differs between seeds", () => {
    const spread: ParticleSpec = { ...SPARK, angle: [0, Math.PI], speed: [0.01, 0.1] };
    const run = (seed: number) => {
      const pool = createPool(6, seed);
      emit(pool, spread, 6, 0, 0);
      stepParticles(pool, 120);
      return particleCloud(pool);
    };
    expect(run(4)).toEqual(run(4));
    expect(run(4)).not.toEqual(run(5));
  });

  it("clears every particle at once", () => {
    const pool = createPool(4, 1);
    emit(pool, SPARK, 4, 0, 0);
    clearPool(pool);
    expect(liveCount(pool)).toBe(0);
    expect(particleCloud(pool)).toEqual([]);
  });
});

describe("the particle cloud", () => {
  it("inks a particle from its ramp, hot at birth", () => {
    const pool = createPool(1, 1);
    emit(pool, SPARK, 1, 3, 4);
    const [pixel] = particleCloud(pool, 10, 20);
    expect(pixel).toEqual({ x: 13, y: 24, ink: "fire-6" });
  });

  it("draws a size-2 particle as a block while young", () => {
    const pool = createPool(1, 1);
    emit(pool, { ...SPARK, size: 2 }, 1, 0, 0);
    expect(particleCloud(pool)).toHaveLength(4);
  });

  it("dithers a fading particle away rather than halving its alpha", () => {
    const pool = createPool(64, 1);
    emit(pool, { ...SPARK, fade: 1, spreadX: 8, spreadY: 8 }, 64, 0, 0);
    stepParticles(pool, 150);
    stepParticles(pool, 140);
    const survivors = particleCloud(pool).length;
    expect(survivors).toBeLessThan(20);
  });
});
