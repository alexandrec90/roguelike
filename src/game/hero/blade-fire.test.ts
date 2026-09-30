import { describe, expect, it } from "vitest";

import { createPool, liveCount, particleCloud, stepParticles } from "../fx/particles";
import { familyRamp } from "../palette";
import {
  bladeLight,
  createFireEmitter,
  EMBERS_PER_MS,
  emitBladeFire,
  emitHitBurst,
  LICKS_PER_MS,
} from "./blade-fire";

const BLADE = { ax: 4, ay: -8, bx: 10, by: -2 };
const STILL = { x: 0, y: 0 };

function burn(frames: number, seed = 5): ReturnType<typeof createPool> {
  const pool = createPool(200, seed);
  const emitter = createFireEmitter(seed);
  for (let frame = 0; frame < frames; frame += 1) {
    stepParticles(pool, 16);
    emitBladeFire(pool, emitter, BLADE, 16, STILL);
  }
  return pool;
}

describe("emitBladeFire", () => {
  it("emits at its rate whatever the frame rate, carrying fractions as debt", () => {
    const pool = createPool(400, 1);
    const emitter = createFireEmitter(1);
    for (let frame = 0; frame < 10; frame += 1) {
      emitBladeFire(pool, emitter, BLADE, 10, STILL);
    }
    expect(liveCount(pool)).toBe(Math.floor(100 * LICKS_PER_MS) + Math.floor(100 * EMBERS_PER_MS));
  });

  it("is born on the blade, then rises", () => {
    const pool = createPool(50, 2);
    emitBladeFire(pool, createFireEmitter(2), BLADE, 16, STILL);
    const born = pool.particles.filter((p) => p.active);
    for (const particle of born) {
      expect(particle.x).toBeGreaterThanOrEqual(BLADE.ax - 1);
      expect(particle.x).toBeLessThanOrEqual(BLADE.bx + 1);
    }
    const startY = born.reduce((sum, p) => sum + p.y, 0) / born.length;
    stepParticles(pool, 80);
    const alive = pool.particles.filter((p) => p.active);
    expect(alive.reduce((sum, p) => sum + p.y, 0) / alive.length).toBeLessThan(startY);
  });

  it("draws only fire inks", () => {
    const fire = familyRamp("fire");
    expect(particleCloud(burn(30)).every((p) => fire.includes(p.ink as never))).toBe(true);
  });

  it("is deterministic per seed", () => {
    expect(particleCloud(burn(20, 9))).toEqual(particleCloud(burn(20, 9)));
    expect(particleCloud(burn(20, 9))).not.toEqual(particleCloud(burn(20, 10)));
  });

  it("clamps a huge delta instead of flooding the pool", () => {
    const pool = createPool(500, 3);
    emitBladeFire(pool, createFireEmitter(3), BLADE, 10_000, STILL);
    expect(liveCount(pool)).toBeLessThan(20);
  });
});

describe("emitHitBurst", () => {
  it("throws sparks, or flame when the blade burns", () => {
    const steel = createPool(20, 4);
    emitHitBurst(steel, 0, 0, false);
    expect(particleCloud(steel).every((p) => p.ink.startsWith("metal"))).toBe(true);
    const fire = createPool(20, 4);
    emitHitBurst(fire, 0, 0, true);
    expect(particleCloud(fire).every((p) => p.ink.startsWith("fire"))).toBe(true);
  });
});

describe("bladeLight", () => {
  it("sits at the blade's middle on screen, flickering but never out", () => {
    const light = bladeLight(BLADE, 100, 90, 0);
    expect(light.x).toBe(107);
    expect(light.y).toBe(85);
    expect(light.color).toMatch(/^#[0-9a-f]{6}$/);
    for (let ms = 0; ms < 2000; ms += 97) {
      const intensity = bladeLight(BLADE, 0, 0, ms).intensity;
      expect(intensity).toBeGreaterThan(0.5);
      expect(intensity).toBeLessThan(1.1);
    }
  });
});
