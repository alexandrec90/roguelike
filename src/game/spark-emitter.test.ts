import { describe, expect, it } from "vitest";

import {
  createEmitter,
  MAX_STEP_MS,
  particleAlpha,
  resetEmitter,
  stepEmitter,
  type EmitterState,
} from "./spark-emitter";

function run(state: EmitterState, steps: number, deltaMs = 16): void {
  for (let index = 0; index < steps; index += 1) {
    stepEmitter(state, deltaMs);
  }
}

function snapshot(state: EmitterState): string {
  return state.particles
    .map((particle) => `${particle.active}:${particle.x.toFixed(4)}:${particle.y.toFixed(4)}`)
    .join("|");
}

describe("createEmitter", () => {
  it("allocates the whole pool up front, all idle", () => {
    const state = createEmitter({ capacity: 5 });

    expect(state.particles).toHaveLength(5);
    expect(state.particles.every((particle) => !particle.active)).toBe(true);
  });

  it("rejects a pool that cannot hold a particle", () => {
    expect(() => createEmitter({ capacity: 0 })).toThrow(/positive integer/);
  });

  it("rejects timings that would spawn forever inside one step", () => {
    expect(() => createEmitter({ spawnIntervalMs: 0 })).toThrow(/spawn interval/);
    expect(() => createEmitter({ lifeMs: 0 })).toThrow(/particle life/);
  });
});

describe("stepEmitter", () => {
  it("produces identical motion for identical seeds", () => {
    const left = createEmitter({ seed: 12345 });
    const right = createEmitter({ seed: 12345 });

    run(left, 60);
    run(right, 60);

    expect(snapshot(left)).toBe(snapshot(right));
  });

  it("produces different motion for different seeds", () => {
    const left = createEmitter({ seed: 1 });
    const right = createEmitter({ seed: 2 });

    run(left, 60);
    run(right, 60);

    expect(snapshot(left)).not.toBe(snapshot(right));
  });

  it("never exceeds the pool, however long it runs", () => {
    const state = createEmitter({ capacity: 4, spawnIntervalMs: 1, spawnJitterMs: 0 });

    run(state, 200);

    expect(state.particles).toHaveLength(4);
    expect(state.particles.filter((particle) => particle.active).length).toBeLessThanOrEqual(4);
  });

  it("retires a particle once it outlives its lifetime", () => {
    const state = createEmitter({ capacity: 1, lifeMs: 50, lifeJitterMs: 0 });

    stepEmitter(state, 16);
    expect(state.particles[0]?.active).toBe(true);

    run(state, 4, 16);
    expect(state.particles[0]?.active).toBe(false);
  });

  it("carries embers upward", () => {
    const state = createEmitter({ capacity: 1, spawnJitterMs: 0, lifeMs: 5000 });

    stepEmitter(state, 16);
    const start = state.particles[0]?.y ?? 0;
    run(state, 5, 16);

    expect(state.particles[0]?.y ?? 0).toBeLessThan(start);
  });

  it("ignores a zero or negative delta", () => {
    const state = createEmitter();
    const before = snapshot(state);

    stepEmitter(state, 0);
    stepEmitter(state, -50);

    expect(snapshot(state)).toBe(before);
  });

  it("clamps a huge delta instead of teleporting the pool", () => {
    const clamped = createEmitter({ seed: 7 });
    const stepped = createEmitter({ seed: 7 });

    stepEmitter(clamped, 10_000);
    stepEmitter(stepped, MAX_STEP_MS);

    expect(snapshot(clamped)).toBe(snapshot(stepped));
  });
});

describe("resetEmitter", () => {
  it("returns the emitter to its opening state, seed included", () => {
    const state = createEmitter({ seed: 99 });
    const fresh = snapshot(createEmitter({ seed: 99 }));

    run(state, 40);
    resetEmitter(state);

    expect(snapshot(state)).toBe(fresh);
    expect(state.rngState).toBe(createEmitter({ seed: 99 }).rngState);
  });
});

describe("particleAlpha", () => {
  it("fades linearly across the particle's life", () => {
    expect(particleAlpha({ active: true, x: 0, y: 0, vx: 0, vy: 0, ageMs: 0, lifeMs: 100 })).toBe(1);
    expect(particleAlpha({ active: true, x: 0, y: 0, vx: 0, vy: 0, ageMs: 50, lifeMs: 100 })).toBe(
      0.5,
    );
  });

  it("is zero for an idle slot", () => {
    expect(particleAlpha({ active: false, x: 0, y: 0, vx: 0, vy: 0, ageMs: 0, lifeMs: 100 })).toBe(
      0,
    );
  });
});
