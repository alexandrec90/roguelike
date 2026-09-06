import { describe, expect, it } from "vitest";

import {
  applyStride,
  DEFAULT_STRAFE_RADIUS,
  forwardOf,
  fromLocal,
  parseStrafeRadius,
  pivotOf,
  PLANET_TILES,
  stepForward,
  stepStrafe,
  strafeLap,
  toLocal,
  wrapDelta,
  wrapTile,
  wrapTurn,
  type PlanetPose,
} from "./planet";

const TAU = Math.PI * 2;
const R = DEFAULT_STRAFE_RADIUS;
const ORIGIN: PlanetPose = { x: 128, y: 128, turn: 0 };

/** Walk a stride in `steps` equal slices, the way a held key does. */
function walk(pose: PlanetPose, gait: "forward" | "strafe", steps: number): PlanetPose {
  let at = pose;
  for (let index = 0; index < steps; index += 1) {
    at = applyStride(at, { gait, distance: 1 }, R);
  }
  return at;
}

describe("wrapTile", () => {
  it("folds both ways into one lap", () => {
    expect(wrapTile(0)).toBe(0);
    expect(wrapTile(PLANET_TILES)).toBe(0);
    expect(wrapTile(PLANET_TILES + 5)).toBe(5);
    expect(wrapTile(-1)).toBe(PLANET_TILES - 1);
  });
});

describe("wrapDelta", () => {
  it("takes the short way round rather than the arithmetic way", () => {
    // 200 tiles east is 56 tiles west. A difference that does not say so flips
    // the whole visible field inside out once a lap.
    expect(wrapDelta(200, 0)).toBe(200 - PLANET_TILES);
    expect(wrapDelta(0, 200)).toBe(PLANET_TILES - 200);
    expect(wrapDelta(5, 3)).toBe(2);
  });

  it("is never longer than half a lap", () => {
    for (let to = 0; to < PLANET_TILES; to += 7) {
      expect(Math.abs(wrapDelta(to, 3))).toBeLessThanOrEqual(PLANET_TILES / 2);
    }
  });
});

describe("wrapTurn", () => {
  it("folds a heading into one revolution", () => {
    expect(wrapTurn(0)).toBeCloseTo(0, 9);
    expect(wrapTurn(TAU)).toBeCloseTo(0, 9);
    expect(wrapTurn(-0.5)).toBeCloseTo(TAU - 0.5, 9);
  });
});

describe("fromLocal and toLocal", () => {
  it("are exact inverses at any heading", () => {
    for (const turn of [0, 0.4, 1.9, 3.6, 5.9]) {
      for (const local of [
        { x: 0, y: 0 },
        { x: 7, y: -3 },
        { x: -11, y: 14 },
      ]) {
        const round = toLocal({ ...ORIGIN, turn }, fromLocal({ ...ORIGIN, turn }, local));
        expect(round.x).toBeCloseTo(local.x, 9);
        expect(round.y).toBeCloseTo(local.y, 9);
      }
    }
  });

  it("is the identity mapping when the hero faces planet north", () => {
    expect(fromLocal(ORIGIN, { x: 3, y: 4 })).toEqual({ x: 131, y: 132 });
  });

  it("puts +y ahead of the hero, whichever way ahead is", () => {
    // Facing a quarter turn right, "one tile ahead" has to be one tile east.
    const east = fromLocal({ ...ORIGIN, turn: Math.PI / 2 }, { x: 0, y: 1 });
    expect(east.x).toBeCloseTo(129, 9);
    expect(east.y).toBeCloseTo(128, 9);
  });

  it("keeps working across the seam", () => {
    const seam: PlanetPose = { x: 1, y: 1, turn: 0 };
    const behind = fromLocal(seam, { x: -4, y: -4 });
    expect(behind).toEqual({ x: PLANET_TILES - 3, y: PLANET_TILES - 3 });
    expect(toLocal(seam, behind).x).toBeCloseTo(-4, 9);
  });
});

describe("stepForward", () => {
  it("moves along the heading and does not turn", () => {
    const ahead = stepForward(ORIGIN, 1);
    expect(ahead).toEqual({ x: 128, y: 129, turn: 0 });
  });

  it("comes back to where it started after one planet lap", () => {
    let pose = ORIGIN;
    for (let step = 0; step < PLANET_TILES; step += 1) {
      pose = stepForward(pose, 1);
    }
    expect(pose.x).toBeCloseTo(ORIGIN.x, 6);
    expect(pose.y).toBeCloseTo(ORIGIN.y, 6);
    expect(pose.turn).toBe(0);
  });

  it("carries the sideways circle along with it", () => {
    // The pivot travels with the walker - that is what "the circle moves with
    // the character when he moves up or down" means.
    const before = pivotOf(ORIGIN, R);
    const after = pivotOf(stepForward(ORIGIN, 1), R);
    expect(after.y - before.y).toBeCloseTo(1, 9);
  });
});

describe("stepStrafe", () => {
  it("moves sideways by the distance asked for, to first order", () => {
    const right = stepStrafe(ORIGIN, 1, R);
    expect(right.x - ORIGIN.x).toBeCloseTo(Math.sin(1 / R) * R, 9);
    expect(right.x).toBeGreaterThan(ORIGIN.x);
  });

  it("turns right when it goes right, so ground and sky sweep the same way", () => {
    expect(stepStrafe(ORIGIN, 1, R).turn).toBeCloseTo(1 / R, 9);
    expect(wrapTurn(stepStrafe(ORIGIN, -1, R).turn)).toBeCloseTo(TAU - 1 / R, 9);
  });

  it("leaves the pivot exactly where it was", () => {
    // The defining invariant: strafing is rotation *about* the circle's centre,
    // so the centre cannot move, however many steps are taken.
    const pivot = pivotOf(ORIGIN, R);
    let pose = ORIGIN;
    for (let step = 0; step < 40; step += 1) {
      pose = stepStrafe(pose, 1, R);
      const now = pivotOf(pose, R);
      expect(now.x).toBeCloseTo(pivot.x, 6);
      expect(now.y).toBeCloseTo(pivot.y, 6);
    }
  });

  it("returns to the same point facing the same way after one lap", () => {
    const lap = strafeLap(R);
    let pose = ORIGIN;
    // 720 slices of the lap: the arc is walked, not chorded.
    for (let step = 0; step < 720; step += 1) {
      pose = stepStrafe(pose, lap / 720, R);
    }
    expect(pose.x).toBeCloseTo(ORIGIN.x, 5);
    expect(pose.y).toBeCloseTo(ORIGIN.y, 5);
    expect(Math.min(pose.turn, TAU - pose.turn)).toBeLessThan(1e-6);
  });

  it("swings the horizon through a full turn over that lap, and no more", () => {
    let pose = ORIGIN;
    let turned = 0;
    for (let step = 0; step < 720; step += 1) {
      const next = stepStrafe(pose, strafeLap(R) / 720, R);
      turned += strafeLap(R) / 720 / R;
      pose = next;
    }
    expect(turned).toBeCloseTo(TAU, 6);
  });

  it("does not need a lap of the planet to close", () => {
    expect(strafeLap(R)).toBeLessThan(PLANET_TILES);
  });

  it("makes ground ahead sweep faster than ground beside you", () => {
    // The parallax gradient is the read of turning. With the pivot behind, a
    // point y tiles ahead moves by d * (1 + y / radius): more than the hero,
    // and more the further ahead it is.
    const after = stepStrafe(ORIGIN, 1, R);
    const beside = toLocal(after, fromLocal(ORIGIN, { x: 0, y: 0 }));
    const ahead = toLocal(after, fromLocal(ORIGIN, { x: 0, y: 10 }));

    // To *first* order: the exact arc is a thousandth of a tile short of the
    // linear law, which is the curvature itself and not an error.
    expect(beside.x).toBeCloseTo(-1, 2);
    expect(ahead.x).toBeCloseTo(-(1 + 10 / R), 2);
    expect(Math.abs(ahead.x)).toBeGreaterThan(Math.abs(beside.x));
  });
});

describe("applyStride", () => {
  it("walks the arc rather than the chord across it", () => {
    // Half a strafe stride is a point on the circle, not the midpoint of the
    // straight line between its ends. At radius 19 the gap is visible.
    const half = applyStride(ORIGIN, { gait: "strafe", distance: 0.5 }, R);
    const whole = applyStride(ORIGIN, { gait: "strafe", distance: 1 }, R);
    const chordY = (ORIGIN.y + whole.y) / 2;

    expect(half.y).not.toBeCloseTo(chordY, 6);
    expect(pivotOf(half, R).x).toBeCloseTo(pivotOf(ORIGIN, R).x, 6);
  });

  it("dispatches the two gaits to the two walks", () => {
    expect(applyStride(ORIGIN, { gait: "forward", distance: 2 }, R)).toEqual(
      stepForward(ORIGIN, 2),
    );
    expect(applyStride(ORIGIN, { gait: "strafe", distance: 2 }, R)).toEqual(
      stepStrafe(ORIGIN, 2, R),
    );
  });
});

describe("forwardOf", () => {
  it("is a unit vector pointing along the heading", () => {
    expect(forwardOf(0)).toEqual({ x: 0, y: 1 });
    expect(forwardOf(Math.PI / 2).x).toBeCloseTo(1, 9);
    expect(Math.hypot(forwardOf(2.3).x, forwardOf(2.3).y)).toBeCloseTo(1, 9);
  });
});

describe("walking around the planet", () => {
  it("takes a whole lap of strafing to undo a hundred sideways steps", () => {
    // The point of the sideways circle: it closes without going round the
    // planet, so a hundred steps left is somewhere genuinely else.
    const away = walk(ORIGIN, "strafe", 100);
    expect(Math.hypot(wrapDelta(away.x, ORIGIN.x), wrapDelta(away.y, ORIGIN.y))).toBeGreaterThan(1);
  });

  it("leaves forward walking unable to change the heading", () => {
    expect(walk(ORIGIN, "forward", 37).turn).toBe(0);
  });
});

describe("parseStrafeRadius", () => {
  it("falls back rather than throwing on anything unreadable", () => {
    expect(parseStrafeRadius(null)).toBe(DEFAULT_STRAFE_RADIUS);
    expect(parseStrafeRadius("")).toBe(DEFAULT_STRAFE_RADIUS);
    expect(parseStrafeRadius("banana")).toBe(DEFAULT_STRAFE_RADIUS);
    expect(parseStrafeRadius("-4")).toBe(DEFAULT_STRAFE_RADIUS);
  });

  it("reads a radius, and refuses one smaller than the screen", () => {
    expect(parseStrafeRadius("64")).toBe(64);
    expect(parseStrafeRadius(" 12.5 ")).toBe(12.5);
    expect(parseStrafeRadius("0.5")).toBeGreaterThanOrEqual(3);
  });
});
