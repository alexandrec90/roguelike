import { describe, expect, it } from "vitest";

import { INK_RAMPS } from "../shading";
import {
  createMotes,
  moteCloud,
  resetMotes,
  stepMotes,
  type MoteField,
  type MoteStep,
} from "./motes";

const AT_ORIGIN: MoteStep = { spawn: () => ({ x: 0, y: 0 }) };

function run(field: MoteField, totalMs: number, sliceMs = 16, step: MoteStep = AT_ORIGIN): void {
  for (let elapsed = 0; elapsed < totalMs; elapsed += sliceMs) {
    stepMotes(field, sliceMs, step);
  }
}

describe("creating a mote field", () => {
  it("allocates the pool once, all inactive", () => {
    const field = createMotes({ capacity: 8 });
    expect(field.motes).toHaveLength(8);
    expect(field.motes.every((mote) => !mote.active)).toBe(true);
  });

  it("rejects an impossible pool or spawn rate", () => {
    expect(() => createMotes({ capacity: 0 })).toThrow(/positive integer/);
    expect(() => createMotes({ spawnIntervalMs: 0 })).toThrow(/greater than zero/);
  });
});

describe("stepping", () => {
  it("spawns at the interval and never exceeds the pool", () => {
    const field = createMotes({ capacity: 6, spawnIntervalMs: 50, lifeMs: 100_000, lifeJitterMs: 0 });
    run(field, 2000);
    expect(field.motes.filter((mote) => mote.active)).toHaveLength(6);
  });

  it("retires a mote when its life runs out", () => {
    const field = createMotes({ capacity: 4, spawnIntervalMs: 1_000_000, lifeMs: 100, lifeJitterMs: 0 });
    stepMotes(field, 16, AT_ORIGIN);
    expect(field.motes.filter((mote) => mote.active)).toHaveLength(1);
    run(field, 400);
    expect(field.motes.filter((mote) => mote.active)).toHaveLength(0);
  });

  it("skips a spawn the caller declines", () => {
    const field = createMotes({ capacity: 4 });
    run(field, 500, 16, { spawn: () => null });
    expect(field.motes.every((mote) => !mote.active)).toBe(true);
  });

  it("carries a mote upward when gravity is negative", () => {
    const field = createMotes({ capacity: 2, spawnIntervalMs: 1_000_000, gravity: -0.0001 });
    stepMotes(field, 16, AT_ORIGIN);
    run(field, 400, 16, { spawn: () => null });
    expect(field.motes[0]?.y).toBeLessThan(0);
  });

  it("applies the caller's force field", () => {
    const field = createMotes({ capacity: 2, spawnIntervalMs: 1_000_000, gravity: 0 });
    stepMotes(field, 16, AT_ORIGIN);
    run(field, 300, 16, { spawn: () => null, force: () => ({ x: 0.0002, y: 0 }) });
    expect(field.motes[0]?.x).toBeGreaterThan(0);
  });

  it("clamps a huge delta rather than integrating it whole", () => {
    const field = createMotes({ capacity: 4, gravity: -0.0001 });
    stepMotes(field, 30_000, AT_ORIGIN);
    expect(Math.abs(field.motes[0]?.y ?? 0)).toBeLessThan(200);
  });

  it("is reproducible from its seed", () => {
    const trace = (): string => {
      const field = createMotes({ capacity: 12, seed: 0x1234 });
      run(field, 1200, 16, { spawn: (die) => ({ x: die() * 4, y: 0 }) });
      return JSON.stringify(field.motes);
    };
    expect(trace()).toBe(trace());
  });
});

describe("drawing and resetting", () => {
  it("inks by remaining life and snaps to whole pixels", () => {
    const field = createMotes({ capacity: 6 });
    run(field, 600);
    const cloud = moteCloud(field, INK_RAMPS.ember);
    expect(cloud.length).toBeGreaterThan(0);
    expect(cloud.every((pixel) => Number.isInteger(pixel.x) && Number.isInteger(pixel.y))).toBe(true);
    expect(cloud.every((pixel) => INK_RAMPS.ember.includes(pixel.ink))).toBe(true);
  });

  it("walks the ramp the other way when asked", () => {
    const field = createMotes({ capacity: 2, spawnIntervalMs: 1_000_000 });
    stepMotes(field, 16, AT_ORIGIN);
    expect(moteCloud(field, INK_RAMPS.ember)[0]?.ink).not.toBe(
      moteCloud(field, INK_RAMPS.ember, true)[0]?.ink,
    );
  });

  it("clears the pool and rewinds the die", () => {
    const field = createMotes({ capacity: 4, seed: 0x99 });
    run(field, 800);
    resetMotes(field);
    expect(field.motes.every((mote) => !mote.active)).toBe(true);
    expect(field.rngState).toBe(0x99);
    expect(moteCloud(field, INK_RAMPS.ember)).toEqual([]);
  });
});
