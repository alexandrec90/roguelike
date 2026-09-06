import { describe, expect, it } from "vitest";

import {
  DEFAULT_STRAFE_RADIUS,
  strafeLap,
  wrapDelta,
  type PlanetPoint,
  type PlanetPose,
} from "./planet";
import {
  activityMsOf,
  advancePlayer,
  ATTACK_MS,
  createPlayer,
  groundPose,
  livePose,
  passable,
  scrollPhase,
  STEP_MS,
  stepProgress,
  walkClipMs,
  type Intent,
  type PlayerState,
  type World,
} from "./player";

const R = DEFAULT_STRAFE_RADIUS;
const START: PlanetPose = { x: 128, y: 128, turn: 0 };
const OPEN: World = { radius: R, blocked: () => false };
const WALLED: World = { radius: R, blocked: () => true };

const NOTHING: Intent = { attack: false };
const north: Intent = { direction: "north", attack: false };
const east: Intent = { direction: "east", attack: false };
const west: Intent = { direction: "west", attack: false };

/** Hold a direction for `steps` whole strides and hand back where it ended. */
function hold(intent: Intent, steps: number, world: World = OPEN): PlayerState {
  let player = createPlayer(START);
  for (let step = 0; step < steps; step += 1) {
    player = advancePlayer(player, intent, STEP_MS, world).player;
  }
  return advancePlayer(player, NOTHING, STEP_MS, world).player;
}

describe("createPlayer", () => {
  it("starts settled on the pose it was handed", () => {
    const player = createPlayer(START);
    expect(player.pose).toEqual(START);
    expect(groundPose(player)).toEqual(START);
    expect(player.activity).toBe("idle");
    expect(player.stride).toBeUndefined();
  });
});

describe("advancePlayer", () => {
  it("commits a whole stride and runs it to completion", () => {
    const started = advancePlayer(createPlayer(START), north, 0, OPEN);
    expect(started.player.activity).toBe("step");
    expect(started.usedDirection).toBe(true);
    expect(started.player.pose.y).toBeCloseTo(129, 9);

    // Half way through, the destination is already decided.
    const half = advancePlayer(started.player, NOTHING, STEP_MS / 2, OPEN);
    expect(half.player.activity).toBe("step");
    expect(half.player.pose).toEqual(started.player.pose);
  });

  it("refuses to be interrupted, and reads the input again when it is free", () => {
    const stepping = advancePlayer(createPlayer(START), north, 0, OPEN).player;
    const interrupted = advancePlayer(stepping, { direction: "south", attack: true }, 10, OPEN);

    expect(interrupted.player.activity).toBe("step");
    expect(interrupted.attacked).toBe(false);
    expect(interrupted.usedDirection).toBe(false);
  });

  it("carries the overshoot into the next action so a held key strides evenly", () => {
    const stepping = advancePlayer(createPlayer(START), north, 0, OPEN).player;
    const next = advancePlayer(stepping, north, STEP_MS + 30, OPEN);

    expect(next.player.activity).toBe("step");
    expect(next.player.activityMs).toBe(30);
    expect(next.player.steps).toBe(1);
  });

  it("turns to face rock and stays put, spending the press either way", () => {
    const blocked = advancePlayer(createPlayer(START), north, 0, WALLED);

    expect(blocked.player.activity).toBe("idle");
    expect(blocked.player.pose).toEqual(START);
    expect(blocked.player.facing).toBe("back");
    expect(blocked.usedDirection).toBe(true);
  });

  it("lets an attack pre-empt a direction pressed on the same frame", () => {
    const both = advancePlayer(createPlayer(START), { direction: "north", attack: true }, 0, OPEN);

    expect(both.player.activity).toBe("attack");
    expect(both.attacked).toBe(true);
    expect(both.usedDirection).toBe(false);
    // It still turned to face the way it was told.
    expect(both.player.facing).toBe("back");
  });

  it("does nothing at all with an empty intent", () => {
    const idle = advancePlayer(createPlayer(START), NOTHING, 16, OPEN);
    expect(idle.player.activity).toBe("idle");
    expect(idle.attacked).toBe(false);
    expect(idle.usedDirection).toBe(false);
  });
});

describe("the four presses", () => {
  it("walk forward and back along the heading without turning", () => {
    expect(hold(north, 4).pose.y).toBeCloseTo(132, 6);
    expect(hold(north, 4).pose.turn).toBe(0);
    expect(hold({ direction: "south", attack: false }, 4).pose.y).toBeCloseTo(124, 6);
  });

  it("walk sideways and turn while doing it", () => {
    // The whole shape of the planet in one assertion: pressing right moves you
    // right *and* swings the world, by one tile over the sideways circle.
    const right = hold(east, 4);
    expect(right.pose.turn).toBeCloseTo(4 / R, 6);
    expect(wrapDelta(right.pose.x, START.x)).toBeGreaterThan(0);

    const left = hold(west, 4);
    expect(wrapDelta(left.pose.x, START.x)).toBeLessThan(0);
  });

  it("bring a sideways walk back to where it began after one lap", () => {
    const lap = Math.round(strafeLap(R));
    const round = hold(east, lap);

    expect(Math.abs(wrapDelta(round.pose.x, START.x))).toBeLessThan(0.6);
    expect(Math.abs(wrapDelta(round.pose.y, START.y))).toBeLessThan(0.6);
  });

  it("face the way they were pressed, mirroring rather than drawing a third view", () => {
    expect(hold(north, 1).facing).toBe("back");
    expect(hold({ direction: "south", attack: false }, 1).facing).toBe("front");
    expect(hold(east, 1)).toMatchObject({ facing: "front", flipX: false });
    expect(hold(west, 1)).toMatchObject({ facing: "front", flipX: true });
  });
});

describe("groundPose and scrollPhase", () => {
  it("are still and zero while nothing is happening", () => {
    const idle = createPlayer(START);
    expect(groundPose(idle)).toEqual(START);
    expect(scrollPhase(idle)).toEqual({ x: 0, y: 0 });
  });

  it("freeze the sample and carry the motion in the phase instead", () => {
    // The contract the whole renderer rests on: during a stride the world is
    // read from where it started, and the picture is offset by how far it has
    // got. Sampling from the live pose would flip a tile mid-stride.
    let player = advancePlayer(createPlayer(START), north, 0, OPEN).player;
    player = advancePlayer(player, NOTHING, STEP_MS / 2, OPEN).player;

    expect(groundPose(player)).toEqual(START);
    expect(scrollPhase(player).y).toBeCloseTo(0.5, 6);
    expect(scrollPhase(player).x).toBe(0);
  });

  it("reach exactly one tile as the sample advances one tile, so the two cancel", () => {
    let player = advancePlayer(createPlayer(START), north, 0, OPEN).player;
    player = advancePlayer(player, NOTHING, STEP_MS - 1, OPEN).player;
    const phase = scrollPhase(player);

    expect(phase.y).toBeGreaterThan(0.99);
    // ...and one frame later the sample has moved on by that same tile.
    const settled = advancePlayer(player, NOTHING, 2, OPEN).player;
    expect(groundPose(settled).y).toBeCloseTo(START.y + 1, 6);
    expect(scrollPhase(settled)).toEqual({ x: 0, y: 0 });
  });

  it("put a sideways stride on the sideways axis", () => {
    let player = advancePlayer(createPlayer(START), east, 0, OPEN).player;
    player = advancePlayer(player, NOTHING, STEP_MS / 2, OPEN).player;

    expect(scrollPhase(player).x).toBeCloseTo(0.5, 6);
    expect(scrollPhase(player).y).toBe(0);
  });
});

describe("livePose", () => {
  it("is the settled pose whenever nothing is running", () => {
    expect(livePose(createPlayer(START), R)).toEqual(START);
  });

  it("turns continuously through a sideways stride, unlike the ground", () => {
    // The horizon is the only thing far enough away to show the turn smoothly,
    // so this is the one view that must not be quantised.
    let player = advancePlayer(createPlayer(START), east, 0, OPEN).player;
    player = advancePlayer(player, NOTHING, STEP_MS / 2, OPEN).player;

    expect(livePose(player, R).turn).toBeCloseTo(0.5 / R, 9);
    expect(groundPose(player).turn).toBe(0);
  });

  it("walks the arc, so mid-stride is on the circle rather than across it", () => {
    let player = advancePlayer(createPlayer(START), east, 0, OPEN).player;
    player = advancePlayer(player, NOTHING, STEP_MS / 2, OPEN).player;
    const half = livePose(player, R);

    expect(half.y).not.toBeCloseTo((START.y + player.pose.y) / 2, 9);
  });
});

describe("stepProgress and walkClipMs", () => {
  it("is 1 whenever no step is running", () => {
    expect(stepProgress(createPlayer(START))).toBe(1);
  });

  it("leads the next stride with the other leg", () => {
    const first = { ...createPlayer(START), activity: "step" as const, activityMs: 0, steps: 0 };
    const second = { ...first, steps: 1 };

    expect(walkClipMs(first, 400)).toBe(0);
    expect(walkClipMs(second, 400)).toBe(200);
  });
});

describe("activityMsOf", () => {
  it("locks each activity for as long as it owns the actor", () => {
    expect(activityMsOf("idle")).toBe(0);
    expect(activityMsOf("step")).toBe(STEP_MS);
    expect(activityMsOf("attack")).toBe(ATTACK_MS);
  });
});

describe("passable", () => {
  it("asks the world and nothing else - a round planet has no edge to fall off", () => {
    const rocky: PlanetPoint = { x: 5, y: 5 };
    expect(passable(OPEN, rocky)).toBe(true);
    expect(passable(WALLED, rocky)).toBe(false);
    // Every coordinate is somewhere, however far outside one lap it is written.
    expect(passable(OPEN, { x: -900, y: 9000 })).toBe(true);
  });
});
