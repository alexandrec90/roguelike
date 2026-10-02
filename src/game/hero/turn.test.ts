import { describe, expect, it } from "vitest";

import { facingYaw } from "../player";
import { easeYaw, TURN_EASE_MS, TURN_SETTLE, turnBetween } from "./turn";

describe("turnBetween", () => {
  it("is the plain difference when that is the short way", () => {
    expect(turnBetween(0, 1)).toBeCloseTo(1, 12);
    expect(turnBetween(1, 0)).toBeCloseTo(-1, 12);
  });

  it("goes the short way across the seam at a half turn", () => {
    // North-west to south-west is a quarter through west, not three quarters through south.
    expect(turnBetween(facingYaw("northwest"), facingYaw("southwest"))).toBeCloseTo(Math.PI / 2, 12);
    expect(turnBetween(3, -3)).toBeCloseTo(2 * Math.PI - 6, 12);
  });

  it("never asks for more than half a turn", () => {
    for (let from = -7; from <= 7; from += 0.37) {
      for (let to = -7; to <= 7; to += 0.53) {
        const delta = turnBetween(from, to);
        expect(Math.abs(delta)).toBeLessThanOrEqual(Math.PI + 1e-12);
        expect(Math.cos(from + delta)).toBeCloseTo(Math.cos(to), 9);
        expect(Math.sin(from + delta)).toBeCloseTo(Math.sin(to), 9);
      }
    }
  });
});

describe("easeYaw", () => {
  it("starts turning on the very frame the facing changes", () => {
    const shown = easeYaw(facingYaw("south"), facingYaw("east"), 16);
    expect(shown).toBeGreaterThan(facingYaw("south"));
    expect(shown).toBeLessThan(facingYaw("east"));
  });

  it("covers 63% of the turn in one time constant", () => {
    const shown = easeYaw(0, 1, TURN_EASE_MS);
    expect(shown).toBeCloseTo(1 - Math.exp(-1), 9);
  });

  it("lands on the facing exactly, so a hero standing still is still", () => {
    let shown = facingYaw("south");
    const target = facingYaw("north");
    for (let frame = 0; frame < 30; frame += 1) {
      shown = easeYaw(shown, target, 16);
    }
    expect(shown).toBe(target);
    expect(easeYaw(target - TURN_SETTLE / 2, target, 16)).toBe(target);
  });

  it("finishes an about-face in about a tenth of a second at 60 fps", () => {
    let shown = facingYaw("south");
    const target = facingYaw("north");
    for (let frame = 0; frame < 7; frame += 1) {
      shown = easeYaw(shown, target, 16);
    }
    expect(Math.abs(turnBetween(shown, target))).toBeLessThan(0.15);
  });

  it("turns the short way round the seam", () => {
    const shown = easeYaw(facingYaw("northwest"), facingYaw("northeast"), 16);
    // North-west to north-east crosses north (±π): down from -3π/4 toward -π, not up through south.
    expect(shown).toBeLessThan(facingYaw("northwest"));
  });

  it("depends only on elapsed time, so two half frames equal one whole one", () => {
    const whole = easeYaw(0, 2, 32);
    const halves = easeYaw(easeYaw(0, 2, 16), 2, 16);
    expect(halves).toBeCloseTo(whole, 12);
  });

  it("holds still on a zero or negative delta, and snaps with no ease at all", () => {
    expect(easeYaw(0, 2, 0)).toBe(0);
    expect(easeYaw(0, 2, -16)).toBe(0);
    expect(easeYaw(0, 2, 16, 0)).toBe(2);
  });
});
