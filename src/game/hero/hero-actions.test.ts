import { describe, expect, it } from "vitest";

import { strikeHits } from "../combat";
import { HEADINGS } from "../keybindings";
import {
  CAST_REACH,
  castEvent,
  headingDirection,
  STRIKE_PUSH,
  STRIKE_RADIUS,
  STRIKE_REACH,
  swingStrike,
} from "./hero-actions";

describe("headingDirection", () => {
  it("turns screen headings into local tiles: north is ahead, east is right", () => {
    expect(headingDirection("north")).toEqual({ x: 0, y: 1 });
    expect(headingDirection("south")).toEqual({ x: 0, y: -1 });
    expect(headingDirection("east")).toEqual({ x: 1, y: 0 });
    expect(headingDirection("west")).toEqual({ x: -1, y: 0 });
  });

  it("is a unit vector for all eight, so a diagonal reaches no further", () => {
    for (const heading of HEADINGS) {
      const { x, y } = headingDirection(heading);
      expect(Math.hypot(x, y)).toBeCloseTo(1, 9);
    }
    const ne = headingDirection("northeast");
    expect(ne.x).toBeCloseTo(Math.SQRT1_2);
    expect(ne.y).toBeCloseTo(Math.SQRT1_2);
  });

  it("never hands out a negative zero", () => {
    expect(Object.is(headingDirection("east").y, -0)).toBe(false);
  });
});

describe("swingStrike", () => {
  it("lands in front of him along his heading, from wherever mid-step he is", () => {
    const strike = swingStrike("east", { x: 0.25, y: 0 }, false);
    expect(strike.at.x).toBeCloseTo(0.25 + STRIKE_REACH);
    expect(strike.at.y).toBeCloseTo(0);
    expect(strike.radius).toBe(STRIKE_RADIUS);
    expect(strike.push).toEqual({ x: STRIKE_PUSH, y: 0 });
  });

  it("reaches a target a tile ahead and misses one behind", () => {
    const strike = swingStrike("north", { x: 0, y: 0 }, false);
    expect(strikeHits(strike, { x: 0, y: 1 })).toBe(true);
    expect(strikeHits(strike, { x: 0, y: -1 })).toBe(false);
  });

  it("is steel for one damage, or fire for two when the blade burns", () => {
    expect(swingStrike("south", { x: 0, y: 0 }, false)).toMatchObject({ damage: 1, element: "steel" });
    expect(swingStrike("south", { x: 0, y: 0 }, true)).toMatchObject({ damage: 2, element: "fire" });
  });
});

describe("castEvent", () => {
  it("leaves the hands a little ahead, flying along the heading", () => {
    const cast = castEvent("southwest", { x: 0, y: 0 });
    expect(cast.element).toBe("fire");
    expect(cast.direction.x).toBeCloseTo(-Math.SQRT1_2);
    expect(cast.direction.y).toBeCloseTo(-Math.SQRT1_2);
    expect(Math.hypot(cast.from.x, cast.from.y)).toBeCloseTo(CAST_REACH);
    expect(cast.heightPx).toBeGreaterThan(0);
  });
});
