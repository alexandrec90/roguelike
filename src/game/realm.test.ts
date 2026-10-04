import { describe, expect, it } from "vitest";

import { OUTDOORS } from "./backdrop";
import { CHAMBER_RADIUS, planetCaves } from "./caves";
import { DEFAULT_TRANSITION_MS } from "./horizon-transition";
import { wrapTile } from "./planet";
import { CAVE, caveShare, OUTSIDE, stepRealm } from "./realm";

const CAVE_AT = planetCaves()[0]!;
const AWAY = { x: wrapTile(CAVE_AT.x + 3), y: CAVE_AT.y };
const LATER = DEFAULT_TRANSITION_MS + 1;

describe("stepRealm", () => {
  it("changes nothing for a walker nowhere near a mouth", () => {
    expect(stepRealm(OUTSIDE, AWAY, 0)).toBe(OUTSIDE);
  });

  it("takes him in when he steps into a mouth, and starts the horizon changing", () => {
    const inside = stepRealm(OUTSIDE, CAVE_AT, 100);
    expect(inside.cave).toBe(CAVE_AT);
    expect(inside.armed).toBe(false);
    expect(inside.transition).toMatchObject({ from: OUTDOORS, to: CAVE, startMs: 100 });
  });

  it("does not throw him straight back out while he stands on the mouth", () => {
    let state = stepRealm(OUTSIDE, CAVE_AT, 0);
    for (const now of [16, 500, LATER, LATER + 500]) {
      state = stepRealm(state, CAVE_AT, now);
      expect(state.cave).toBe(CAVE_AT);
    }
    expect(state.transition).toBeUndefined();
  });

  it("lets him out once he has stepped off the mouth and back onto it", () => {
    let state = stepRealm(OUTSIDE, CAVE_AT, 0);
    state = stepRealm(state, AWAY, LATER);
    expect(state.armed).toBe(true);
    expect(state.cave).toBe(CAVE_AT);
    state = stepRealm(state, CAVE_AT, LATER + 100);
    expect(state.cave).toBeUndefined();
    expect(state.transition).toMatchObject({ from: CAVE, to: OUTDOORS });
  });

  it("ignores the mouth while a change is in flight", () => {
    let state = stepRealm(OUTSIDE, CAVE_AT, 0);
    state = stepRealm(state, AWAY, 100);
    state = stepRealm(state, CAVE_AT, 200);
    expect(state.cave).toBe(CAVE_AT);
    expect(state.transition?.startMs).toBe(0);
  });

  it("keeps him in the cave anywhere in the chamber", () => {
    let state = stepRealm(OUTSIDE, CAVE_AT, 0);
    state = stepRealm(state, { x: CAVE_AT.x, y: wrapTile(CAVE_AT.y + CHAMBER_RADIUS - 1) }, LATER);
    expect(state.cave).toBe(CAVE_AT);
  });
});

describe("caveShare", () => {
  it("is 0 outside, 1 inside, and the transition's progress between", () => {
    expect(caveShare(OUTSIDE, 0)).toBe(0);
    const entering = stepRealm(OUTSIDE, CAVE_AT, 0);
    expect(caveShare(entering, 0)).toBe(0);
    expect(caveShare(entering, DEFAULT_TRANSITION_MS / 2)).toBeCloseTo(0.5);
    const settled = stepRealm(entering, CAVE_AT, LATER);
    expect(caveShare(settled, LATER)).toBe(1);
  });

  it("runs back down on the way out", () => {
    let state = stepRealm(OUTSIDE, CAVE_AT, 0);
    state = stepRealm(state, AWAY, LATER);
    state = stepRealm(state, CAVE_AT, 2000);
    expect(caveShare(state, 2000)).toBe(1);
    expect(caveShare(state, 2000 + DEFAULT_TRANSITION_MS)).toBe(0);
  });
});
