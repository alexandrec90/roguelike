import { describe, expect, it } from "vitest";

import { bufferPixel, createBuffer } from "../pixel-buffer";
import {
  clearRainField,
  createRainField,
  landingBand,
  liveDrops,
  paintRain,
  rainCloud,
  RAIN_SHEETS,
  stepRainField,
  type Landing,
  type RainEnv,
  type RainField,
} from "./rain";

const ENV: RainEnv = { rain: 1, slant: 0.4, width: 320, height: 180, groundTop: 22 };

function run(field: RainField, ms: number, env: RainEnv = ENV): Landing[] {
  const landed: Landing[] = [];
  for (let t = 0; t < ms; t += 16) {
    stepRainField(field, 16, env, (landing) => landed.push(landing));
  }
  return landed;
}

describe("createRainField", () => {
  it("allocates a fixed pool and refuses a nonsense capacity", () => {
    expect(createRainField(12).drops).toHaveLength(12);
    expect(() => createRainField(0)).toThrow(/capacity/);
    expect(() => createRainField(1.5)).toThrow(/capacity/);
  });
});

describe("stepRainField", () => {
  it("is deterministic for the same seed and deltas", () => {
    const a = createRainField(320, 7);
    const b = createRainField(320, 7);
    expect(run(a, 2000)).toEqual(run(b, 2000));
    const c = createRainField(320, 8);
    expect(run(c, 2000)).not.toEqual(run(createRainField(320, 7), 2000));
  });

  it("lands every drop on its own sheet's band of the field", () => {
    const landed = run(createRainField(), 4000);
    expect(landed.length).toBeGreaterThan(100);
    for (const landing of landed) {
      const [near, far] = landingBand(landing.sheet, ENV);
      expect(landing.y).toBeGreaterThanOrEqual(Math.floor(near));
      expect(landing.y).toBeLessThanOrEqual(Math.ceil(far));
      // And it came down from above, along the slant.
      expect(landing.fromY).toBeLessThan(landing.y + 0.001);
    }
    const sheets = new Set(landed.map((landing) => landing.sheet));
    expect(sheets).toEqual(new Set([0, 1, 2]));
  });

  it("puts far drops up by the horizon and near drops in the foreground", () => {
    const landed = run(createRainField(), 4000);
    const meanY = (sheet: number): number => {
      const ys = landed.filter((landing) => landing.sheet === sheet).map((landing) => landing.y);
      return ys.reduce((sum, y) => sum + y, 0) / ys.length;
    };
    expect(meanY(0)).toBeLessThan(meanY(1));
    expect(meanY(1)).toBeLessThan(meanY(2));
  });

  it("covers the whole width, upwind edge included, despite the slant", () => {
    const xs = run(createRainField(), 6000).map((landing) => landing.x);
    expect(Math.min(...xs)).toBeLessThan(20);
    expect(Math.max(...xs)).toBeGreaterThan(300);
  });

  it("scales density with the rain level, and stops at zero", () => {
    const heavy = run(createRainField(), 3000).length;
    const light = run(createRainField(), 3000, { ...ENV, rain: 0.25 }).length;
    const dry = run(createRainField(), 3000, { ...ENV, rain: 0 }).length;
    expect(light).toBeLessThan(heavy * 0.5);
    expect(light).toBeGreaterThan(0);
    expect(dry).toBe(0);
  });

  it("holds roughly the designed number of drops on screen", () => {
    const field = createRainField(400);
    run(field, 3000);
    const designed = RAIN_SHEETS.reduce((sum, sheet) => sum + sheet.count, 0);
    expect(liveDrops(field)).toBeGreaterThan(designed * 0.6);
    expect(liveDrops(field)).toBeLessThan(designed * 1.4);
  });

  it("never outgrows its pool, and a long frame is clamped", () => {
    const field = createRainField(20);
    run(field, 3000);
    expect(liveDrops(field)).toBeLessThanOrEqual(20);
    const drop = field.drops.find((candidate) => candidate.active);
    const before = drop?.y ?? 0;
    stepRainField(field, 10_000, ENV, () => undefined);
    if (drop?.active === true) {
      expect(drop.y - before).toBeLessThanOrEqual(RAIN_SHEETS[drop.sheet].speed * 50 + 1e-9);
    }
  });

  it("clears on demand", () => {
    const field = createRainField();
    run(field, 1000);
    clearRainField(field);
    expect(liveDrops(field)).toBe(0);
  });
});

describe("painting rain", () => {
  it("draws streaks that lean along the slant, and only live drops", () => {
    const field = createRainField(4, 3);
    const drop = field.drops[0];
    if (drop === undefined) {
      throw new Error("unreachable");
    }
    Object.assign(drop, { active: true, sheet: 2, x: 50, y: 40, landY: 120 });
    const cloud = rainCloud(field, 0.5, 1);
    expect(cloud).toHaveLength(RAIN_SHEETS[2].length);
    const head = cloud[cloud.length - 1];
    const tail = cloud[0];
    expect(head).toMatchObject({ x: 50, y: 40 });
    expect(tail?.y).toBe(40 - (RAIN_SHEETS[2].length - 1));
    expect(tail?.x).toBeLessThan(50);
  });

  it("dims at night by walking down the ramp, never vanishing", () => {
    const field = createRainField(4, 3);
    Object.assign(field.drops[0] as object, { active: true, sheet: 1, x: 10, y: 10, landY: 90 });
    const day = rainCloud(field, 0.4, 1).map((pixel) => pixel.ink);
    const night = rainCloud(field, 0.4, 0).map((pixel) => pixel.ink);
    expect(night).toHaveLength(day.length);
    expect(night).not.toEqual(day);
  });

  it("composites into a buffer at the sheet's own opacity", () => {
    const field = createRainField(4, 3);
    Object.assign(field.drops[0] as object, { active: true, sheet: 0, x: 5, y: 5, landY: 20 });
    const buffer = createBuffer(16, 16);
    paintRain(buffer, field, 0, 1);
    const alpha = bufferPixel(buffer, 5, 5)[3];
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(255);
    expect(bufferPixel(buffer, 12, 12)[3]).toBe(0);
  });
});
