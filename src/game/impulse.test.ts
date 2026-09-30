import { describe, expect, it } from "vitest";

import {
  createImpulse,
  impulseSink,
  kickHitStop,
  kickShake,
  MAX_HIT_STOP_MS,
  MAX_SHAKE,
  shakeOffset,
  stepImpulse,
} from "./impulse";

describe("screen shake", () => {
  it("is still until kicked, and decays back to still", () => {
    const state = createImpulse();
    expect(shakeOffset(state)).toEqual({ x: 0, y: 0 });
    kickShake(state, 3, 100);
    stepImpulse(state, 50);
    expect(state.shake).toBeCloseTo(1.5, 6);
    stepImpulse(state, 60);
    expect(state.shake).toBe(0);
    expect(shakeOffset(state)).toEqual({ x: 0, y: 0 });
  });

  it("is capped, in whole pixels, and never shrinks a stronger shake", () => {
    const state = createImpulse();
    kickShake(state, 99);
    expect(state.shake).toBe(MAX_SHAKE);
    kickShake(state, 1);
    expect(state.shake).toBe(MAX_SHAKE);
    for (let index = 0; index < 20; index += 1) {
      const offset = shakeOffset(state);
      expect(Number.isInteger(offset.x) && Number.isInteger(offset.y)).toBe(true);
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(MAX_SHAKE);
      state.clockMs += 32;
    }
  });

  it("repeats for the same clock", () => {
    const one = createImpulse();
    const two = createImpulse();
    kickShake(one, 3);
    kickShake(two, 3);
    stepImpulse(one, 40);
    stepImpulse(two, 40);
    expect(shakeOffset(one)).toEqual(shakeOffset(two));
  });
});

describe("hit stop", () => {
  it("swallows the world's delta while it holds, then lets it through", () => {
    const state = createImpulse();
    kickHitStop(state, 50);
    expect(stepImpulse(state, 16)).toBe(0);
    expect(stepImpulse(state, 16)).toBe(0);
    expect(stepImpulse(state, 30)).toBe(12);
    expect(stepImpulse(state, 16)).toBe(16);
  });

  it("is capped, and a sink writes through to the state", () => {
    const state = createImpulse();
    const sink = impulseSink(state);
    sink.hitStop(10_000);
    sink.shake(2);
    expect(state.stopMs).toBe(MAX_HIT_STOP_MS);
    expect(state.shake).toBe(2);
  });
});
