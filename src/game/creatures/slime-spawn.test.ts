import { describe, expect, it } from "vitest";

import { PLANET_TILES } from "../planet";
import { SLIME_VARIANTS } from "./slime-palette";
import {
  denAt,
  densNear,
  planetDistance,
  RESPAWN_SCATTER,
  slimeSeed,
  spawnPoint,
  variantOf,
} from "./slime-spawn";

const OPEN = (): boolean => false;

describe("slime dens", () => {
  it("are a pure function of the planet cell", () => {
    for (let x = 0; x < 40; x += 1) {
      expect(denAt(x, 17, OPEN)).toEqual(denAt(x, 17, OPEN));
    }
  });

  it("wrap with the planet: a cell a lap away is the same den", () => {
    const found = densNear({ x: 60, y: 60 }, 30, OPEN);
    const den = found[0];
    expect(den).toBeDefined();
    if (den !== undefined) {
      expect(denAt(den.cellX + PLANET_TILES, den.cellY - PLANET_TILES, OPEN)).toEqual(den);
    }
  });

  it("sit inside their own cell", () => {
    for (const den of densNear({ x: 128, y: 128 }, 40, OPEN)) {
      expect(den.point.x).toBeGreaterThanOrEqual(den.cellX);
      expect(den.point.x).toBeLessThan(den.cellX + 1);
      expect(den.key).toBe(den.cellY * PLANET_TILES + den.cellX);
    }
  });

  it("are a handful within twelve tiles, on average", () => {
    let total = 0;
    const samples = 24;
    for (let index = 0; index < samples; index += 1) {
      total += densNear({ x: index * 10.3, y: index * 7.1 }, 12, OPEN).length;
    }
    const mean = total / samples;
    expect(mean).toBeGreaterThan(2);
    expect(mean).toBeLessThan(10);
  });

  it("are only ever found within the reach asked for, across the seam", () => {
    const centre = { x: 1, y: PLANET_TILES - 2 };
    for (const den of densNear(centre, 12, OPEN)) {
      expect(planetDistance(den.point, centre)).toBeLessThanOrEqual(12);
    }
  });

  it("never stand on blocked ground", () => {
    expect(densNear({ x: 128, y: 128 }, 40, () => true)).toEqual([]);
  });
});

describe("respawning", () => {
  const den = densNear({ x: 128, y: 128 }, 40, OPEN)[0];

  it("puts the first slime at the den and later ones within the scatter", () => {
    expect(den).toBeDefined();
    if (den === undefined) return;
    expect(spawnPoint(den, 0, OPEN)).toEqual(den.point);
    for (let generation = 1; generation < 20; generation += 1) {
      const point = spawnPoint(den, generation, OPEN);
      expect(planetDistance(point, den.point)).toBeLessThanOrEqual(RESPAWN_SCATTER + 1e-9);
    }
  });

  it("falls back to the den when everywhere else is blocked", () => {
    if (den === undefined) return;
    expect(spawnPoint(den, 3, (point) => point !== den.point)).toEqual(den.point);
  });

  it("gives each generation its own seed", () => {
    if (den === undefined) return;
    expect(slimeSeed(den, 0)).not.toBe(slimeSeed(den, 1));
    expect(slimeSeed(den, 2)).toBe(slimeSeed(den, 2));
  });
});

describe("variants", () => {
  it("are mostly green, and every variant turns up", () => {
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 2000; seed += 1) {
      const variant = variantOf(seed * 131);
      counts.set(variant, (counts.get(variant) ?? 0) + 1);
    }
    for (const variant of SLIME_VARIANTS) {
      expect(counts.get(variant) ?? 0).toBeGreaterThan(0);
    }
    expect(counts.get("green") ?? 0).toBeGreaterThan(1000);
  });
});
