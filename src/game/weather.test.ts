import { describe, expect, it } from "vitest";

import { stepEmitter } from "./spark-emitter";
import {
  createRain,
  lightningAt,
  lightningBolt,
  RAIN_FALL_SPEED,
  RAIN_SLANT,
} from "./weather";

describe("createRain", () => {
  it("makes drops that fall, from a strip above the frame", () => {
    const rain = createRain(320);
    // Negative riseY is the emitter's "downward" — the drops must fall.
    expect(rain.config.riseY).toBeLessThan(0);
    expect(rain.config.originY).toBeLessThan(0);

    for (let step = 0; step < 40; step += 1) {
      stepEmitter(rain, 16);
    }
    const active = rain.particles.filter((particle) => particle.active);
    expect(active.length).toBeGreaterThan(0);
    const drop = active[0];
    if (drop === undefined) {
      throw new Error("unreachable");
    }
    const before = drop.y;
    stepEmitter(rain, 160);
    expect(drop.y).toBeGreaterThan(before);
  });

  it("blows the drops sideways at the slant the streak is drawn on", () => {
    const rain = createRain(320);
    expect(rain.config.windX).toBeCloseTo(RAIN_FALL_SPEED * RAIN_SLANT, 10);
    // The jitter is a rounding error next to the wind, so every drop leans the
    // same way — a slanted sky with a few drops falling straight is worse than
    // no slant at all.
    expect(rain.config.driftX).toBeLessThan(rain.config.windX);

    for (let step = 0; step < 40; step += 1) {
      stepEmitter(rain, 16);
    }
    const drop = rain.particles.find((particle) => particle.active);
    if (drop === undefined) {
      throw new Error("unreachable");
    }
    const from = { x: drop.x, y: drop.y };
    stepEmitter(rain, 100);
    expect(drop.x).toBeGreaterThan(from.x);
    expect((drop.x - from.x) / (drop.y - from.y)).toBeCloseTo(RAIN_SLANT, 1);
  });

  it("aims the spawn strip upwind so the slant still covers the frame", () => {
    const rain = createRain(320);
    // Shifted upwind of centre, and wide enough that what lands on the right
    // edge was launched from off the left of it.
    expect(rain.config.originX).toBeLessThan(160);
    expect(rain.config.originX + rain.config.spreadX).toBeGreaterThan(320);
  });

  it("rains on the near edge of the frame as well as the far one", () => {
    const rain = createRain(320);
    const landed: number[] = [];
    for (let step = 0; step < 2000; step += 1) {
      stepEmitter(rain, 16);
      for (const particle of rain.particles) {
        if (particle.active && particle.y >= 170 && particle.y < 176) {
          landed.push(particle.x);
        }
      }
    }
    expect(Math.min(...landed)).toBeLessThan(40);
    expect(Math.max(...landed)).toBeGreaterThan(280);
  });

  it("takes overrides for a scene that wants a different sky", () => {
    expect(createRain(320, { capacity: 3 }).particles).toHaveLength(3);
  });
});

describe("lightningBolt", () => {
  it("is deterministic per seed and descends monotonically to the target", () => {
    const a = lightningBolt(42, 100, 0, 30);
    expect(a).toEqual(lightningBolt(42, 100, 0, 30));
    expect(a).not.toEqual(lightningBolt(43, 100, 0, 30));

    expect(a[0]).toEqual({ x: 100, y: 0 });
    expect(a[a.length - 1]?.y).toBe(30);
    for (let index = 1; index < a.length; index += 1) {
      expect(a[index]?.y).toBeGreaterThan(a[index - 1]?.y ?? Number.POSITIVE_INFINITY);
    }
  });

  it("wanders sideways but stays pulled near the strike column", () => {
    const points = lightningBolt(7, 50, 0, 60);
    const xs = points.map((point) => point.x);
    expect(new Set(xs).size).toBeGreaterThan(1);
    expect(Math.max(...xs.map((x) => Math.abs(x - 50)))).toBeLessThan(30);
  });

  it("refuses a bolt that would strike upward", () => {
    expect(() => lightningBolt(1, 0, 10, 10)).toThrow(/downward/);
  });
});

describe("lightningAt", () => {
  it("is a pure function of time and seed", () => {
    for (let ms = 0; ms < 30000; ms += 500) {
      expect(lightningAt(ms, 0x51a7)).toEqual(lightningAt(ms, 0x51a7));
    }
  });

  it("strikes briefly: active instants are rare and carry a stable bolt", () => {
    let activeMs = 0;
    let sampled = 0;
    const seen = new Set<number>();
    for (let ms = 0; ms < 90000; ms += 16) {
      const state = lightningAt(ms, 0x51a7);
      sampled += 16;
      if (state.active) {
        activeMs += 16;
        seen.add(state.boltSeed);
        expect(state.alpha).toBeGreaterThan(0);
        expect(state.alpha).toBeLessThanOrEqual(1);
        expect(state.xUnit).toBeGreaterThanOrEqual(0);
        expect(state.xUnit).toBeLessThan(1);
      }
    }
    // Ten 9s windows, ~70% with one 160ms strike: well under 5% of the time.
    expect(activeMs).toBeGreaterThan(0);
    expect(activeMs / sampled).toBeLessThan(0.05);
    // Different windows strike with different bolts.
    expect(seen.size).toBeGreaterThan(1);
  });

  it("keeps the bolt seed and strike column stable within one strike", () => {
    // Find a strike, then sample inside it.
    for (let ms = 0; ms < 90000; ms += 16) {
      const state = lightningAt(ms, 0x51a7);
      if (state.active) {
        const later = lightningAt(ms + 32, 0x51a7);
        if (later.active) {
          expect(later.boltSeed).toBe(state.boltSeed);
          expect(later.xUnit).toBe(state.xUnit);
        }
        return;
      }
    }
    throw new Error("No strike found in 90 seconds of schedule");
  });
});
