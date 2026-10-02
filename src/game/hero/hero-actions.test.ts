import { describe, expect, it } from "vitest";

import { strikeHits } from "../combat";
import { HEADING_VECTOR, HEADINGS } from "../keybindings";
import { facingYaw } from "../player";
import {
  CAST_REACH,
  castEvent,
  facingDirection,
  STRIKE_PUSH,
  STRIKE_RADIUS,
  STRIKE_REACH,
  swingStrike,
} from "./hero-actions";

describe("facingDirection", () => {
  it("turns facings into local tiles: north is ahead, east is right", () => {
    const close = (facing: number, x: number, y: number): void => {
      const direction = facingDirection(facing);
      expect(direction.x).toBeCloseTo(x, 12);
      expect(direction.y).toBeCloseTo(y, 12);
    };
    close(facingYaw("north"), 0, 1);
    close(facingYaw("south"), 0, -1);
    close(facingYaw("east"), 1, 0);
    close(facingYaw("west"), -1, 0);
  });

  it("points the way each of the eight headings does", () => {
    for (const heading of HEADINGS) {
      const { dx, dy } = HEADING_VECTOR[heading];
      const { x, y } = facingDirection(facingYaw(heading));
      expect(Math.atan2(y, x)).toBeCloseTo(Math.atan2(-dy, dx), 12);
    }
  });

  it("is a unit vector at any angle, so no facing reaches further", () => {
    for (let index = 0; index < 32; index += 1) {
      const { x, y } = facingDirection((index / 32) * 2 * Math.PI - Math.PI);
      expect(Math.hypot(x, y)).toBeCloseTo(1, 12);
    }
  });

  it("never hands out a negative zero", () => {
    expect(Object.is(facingDirection(0).x, -0)).toBe(false);
  });
});

describe("swingStrike", () => {
  it("lands in front of him along his facing, from wherever mid-step he is", () => {
    const strike = swingStrike(facingYaw("east"), { x: 0.25, y: 0 }, false);
    expect(strike.at.x).toBeCloseTo(0.25 + STRIKE_REACH);
    expect(strike.at.y).toBeCloseTo(0);
    expect(strike.radius).toBe(STRIKE_RADIUS);
    expect(strike.push?.x).toBeCloseTo(STRIKE_PUSH);
    expect(strike.push?.y).toBeCloseTo(0);
  });

  it("reaches a target a tile ahead and misses one behind", () => {
    const strike = swingStrike(facingYaw("north"), { x: 0, y: 0 }, false);
    expect(strikeHits(strike, { x: 0, y: 1 })).toBe(true);
    expect(strikeHits(strike, { x: 0, y: -1 })).toBe(false);
  });

  it("lands between two headings when he faces between them", () => {
    const between = (facingYaw("north") + facingYaw("northeast")) / 2;
    const strike = swingStrike(between, { x: 0, y: 0 }, false);
    expect(Math.atan2(strike.at.y, strike.at.x)).toBeCloseTo((3 * Math.PI) / 8, 9);
  });

  it("is steel for one damage, or fire for two when the blade burns", () => {
    const south = facingYaw("south");
    expect(swingStrike(south, { x: 0, y: 0 }, false)).toMatchObject({ damage: 1, element: "steel" });
    expect(swingStrike(south, { x: 0, y: 0 }, true)).toMatchObject({ damage: 2, element: "fire" });
  });
});

describe("castEvent", () => {
  it("leaves the hands a little ahead, flying along the facing", () => {
    const cast = castEvent(facingYaw("southwest"), { x: 0, y: 0 });
    expect(cast.element).toBe("fire");
    expect(cast.direction.x).toBeCloseTo(-Math.SQRT1_2);
    expect(cast.direction.y).toBeCloseTo(-Math.SQRT1_2);
    expect(Math.hypot(cast.from.x, cast.from.y)).toBeCloseTo(CAST_REACH);
    expect(cast.heightPx).toBeGreaterThan(0);
  });
});
