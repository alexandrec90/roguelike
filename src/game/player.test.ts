import { describe, expect, it } from "vitest";

import type { Heading } from "./keybindings";
import {
  DEFAULT_STRAFE_RADIUS,
  strafeLap,
  wrapDelta,
  type PlanetPoint,
  type PlanetPose,
} from "./planet";
import {
  advancePlayer,
  attackProgress,
  ATTACK_MS,
  createPlayer,
  DIAGONAL_STEP_MS,
  gaitOf,
  groundPose,
  livePose,
  passable,
  scrollPhase,
  STEP_MS,
  stepDurationMs,
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

/** Rock filling everything more than half a tile to the right of the start. */
const WALL_RIGHT: World = { radius: R, blocked: (p) => wrapDelta(p.x, START.x) > 0.5 };
/** Rock filling everything more than half a tile ahead of the start. */
const WALL_AHEAD: World = { radius: R, blocked: (p) => wrapDelta(p.y, START.y) > 0.5 };

const NOTHING: Intent = { attack: false };

function walk(heading: Heading): Intent {
  return { heading, attack: false };
}

const north = walk("north");
const south = walk("south");
const east = walk("east");
const west = walk("west");

/** Hold a heading for `steps` whole strides and hand back where it ended. */
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
    expect(player.motion).toBe("idle");
    expect(player.gait).toBeUndefined();
    expect(player.attackMs).toBeUndefined();
  });
});

describe("gaitOf", () => {
  it("reads the screen-space heading as the planet's two walks", () => {
    // `HEADING_VECTOR` says north is *up* (dy -1) and forward runs up the
    // screen, so this sign flip is the whole of the conversion.
    expect(gaitOf("north")).toEqual({ forward: 1, strafe: 0 });
    expect(gaitOf("south")).toEqual({ forward: -1, strafe: 0 });
    expect(gaitOf("east")).toEqual({ forward: 0, strafe: 1 });
    expect(gaitOf("west")).toEqual({ forward: 0, strafe: -1 });
    expect(gaitOf("northeast")).toEqual({ forward: 1, strafe: 1 });
    expect(gaitOf("southwest")).toEqual({ forward: -1, strafe: -1 });
  });
});

describe("advancePlayer", () => {
  it("commits a whole stride and runs it to completion", () => {
    const started = advancePlayer(createPlayer(START), north, 0, OPEN);
    expect(started.player.motion).toBe("step");
    expect(started.usedHeading).toBe(true);
    expect(started.player.pose.y).toBeCloseTo(129, 9);

    // Half way through, the destination is already decided.
    const half = advancePlayer(started.player, NOTHING, STEP_MS / 2, OPEN);
    expect(half.player.motion).toBe("step");
    expect(half.player.pose).toEqual(started.player.pose);
  });

  it("refuses to interrupt the step it is in, and reads the input again when it lands", () => {
    const stepping = advancePlayer(createPlayer(START), north, 0, OPEN).player;
    const interrupted = advancePlayer(stepping, south, 10, OPEN);

    expect(interrupted.player.motion).toBe("step");
    expect(interrupted.player.pose).toEqual(stepping.pose);
    expect(interrupted.usedHeading).toBe(false);
  });

  it("carries the overshoot into the next action so a held key strides evenly", () => {
    const stepping = advancePlayer(createPlayer(START), north, 0, OPEN).player;
    const next = advancePlayer(stepping, north, STEP_MS + 30, OPEN);

    expect(next.player.motion).toBe("step");
    expect(next.player.motionMs).toBe(30);
    expect(next.player.steps).toBe(1);
  });

  it("never carries more than one step's worth, however long the tab slept", () => {
    const stepping = advancePlayer(createPlayer(START), north, 0, OPEN).player;
    const next = advancePlayer(stepping, north, 10_000, OPEN);
    expect(next.player.motionMs).toBe(STEP_MS);
  });

  it("does not run time backwards on a negative delta", () => {
    const stepping = advancePlayer(createPlayer(START), north, 0, OPEN).player;
    const aged = advancePlayer(stepping, north, 50, OPEN).player;
    expect(advancePlayer(aged, north, -100, OPEN).player.motionMs).toBe(50);
  });

  it("turns to face rock and stays put, spending the press either way", () => {
    const blocked = advancePlayer(createPlayer(START), north, 0, WALLED);

    expect(blocked.player.motion).toBe("idle");
    expect(blocked.player.pose).toEqual(START);
    expect(blocked.player.facing).toBe("back");
    expect(blocked.usedHeading).toBe(true);
  });

  it("does nothing at all with an empty intent", () => {
    const idle = advancePlayer(createPlayer(START), NOTHING, 16, OPEN);
    expect(idle.player.motion).toBe("idle");
    expect(idle.attacked).toBe(false);
    expect(idle.usedHeading).toBe(false);
  });
});

describe("the four presses", () => {
  it("walk forward and back along the heading without turning", () => {
    expect(hold(north, 4).pose.y).toBeCloseTo(132, 6);
    expect(hold(north, 4).pose.turn).toBe(0);
    expect(hold(south, 4).pose.y).toBeCloseTo(124, 6);
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
    expect(hold(south, 1).facing).toBe("front");
    expect(hold(east, 1)).toMatchObject({ facing: "front", flipX: false });
    expect(hold(west, 1)).toMatchObject({ facing: "front", flipX: true });
  });
});

describe("stepping diagonally", () => {
  it("walks forward and sideways at once when two keys are held", () => {
    const player = advancePlayer(createPlayer(START), walk("northeast"), 0, OPEN).player;

    expect(player.gait).toEqual({ forward: 1, strafe: 1 });
    expect(wrapDelta(player.pose.x, START.x)).toBeGreaterThan(0);
    expect(wrapDelta(player.pose.y, START.y)).toBeGreaterThan(0);
    // A strafe is still a strafe on a diagonal, so the world still turns.
    expect(player.pose.turn).toBeCloseTo(1 / R, 9);
  });

  it("reaches all four corners", () => {
    const corners = [
      ["northeast", { x: 1, y: 1 }],
      ["northwest", { x: -1, y: 1 }],
      ["southeast", { x: 1, y: -1 }],
      ["southwest", { x: -1, y: -1 }],
    ] as const;

    for (const [heading, sign] of corners) {
      const { pose } = advancePlayer(createPlayer(START), walk(heading), 0, OPEN).player;
      expect(Math.sign(wrapDelta(pose.x, START.x))).toBe(sign.x);
      expect(Math.sign(wrapDelta(pose.y, START.y))).toBe(sign.y);
    }
  });

  it("takes root-two as long, so a zigzag is not a shortcut", () => {
    const diagonal = advancePlayer(createPlayer(START), walk("northeast"), 0, OPEN).player;
    expect(stepDurationMs(diagonal)).toBe(DIAGONAL_STEP_MS);
    expect(DIAGONAL_STEP_MS / STEP_MS).toBeCloseTo(Math.SQRT2, 2);

    // Still mid-step at the moment a cardinal one would have landed.
    const early = advancePlayer(diagonal, NOTHING, STEP_MS, OPEN).player;
    expect(early.motion).toBe("step");
    expect(stepProgress(early)).toBeCloseTo(STEP_MS / DIAGONAL_STEP_MS, 5);

    const landed = advancePlayer(early, NOTHING, DIAGONAL_STEP_MS - STEP_MS, OPEN).player;
    expect(landed.motion).toBe("idle");
    expect(landed.pose).toEqual(diagonal.pose);
  });

  it("slides along the wall it clips instead of stopping dead against it", () => {
    // Rock to the right: the sideways half of the diagonal is refused, so it
    // walks the forward half rather than cancelling the whole step.
    const sideways = advancePlayer(createPlayer(START), walk("northeast"), 0, WALL_RIGHT);
    expect(sideways.player.gait).toEqual({ forward: 1, strafe: 0 });
    expect(sideways.player.pose.y).toBeCloseTo(129, 9);
    expect(sideways.usedHeading).toBe(true);

    // Rock straight ahead: the forward half is gone too, so it strafes.
    const ahead = advancePlayer(createPlayer(START), walk("northeast"), 0, WALL_AHEAD);
    expect(ahead.player.gait).toEqual({ forward: 0, strafe: 1 });
    expect(ahead.player.pose.turn).toBeCloseTo(1 / R, 9);
  });

  it("still refuses when neither half of the diagonal is open", () => {
    const corner = advancePlayer(createPlayer(START), walk("southwest"), 0, WALLED);

    expect(corner.player.pose).toEqual(START);
    expect(corner.player.motion).toBe("idle");
    expect(corner.usedHeading).toBe(true);
  });

  it("reuses the same two drawings for the diagonals", () => {
    const expected = [
      ["northeast", { facing: "back", flipX: false }],
      ["northwest", { facing: "back", flipX: true }],
      ["southeast", { facing: "front", flipX: false }],
      ["southwest", { facing: "front", flipX: true }],
    ] as const;

    for (const [heading, orientation] of expected) {
      const player = advancePlayer(createPlayer(START), walk(heading), 0, OPEN).player;
      expect(player).toMatchObject(orientation);
    }
  });
});

describe("facing", () => {
  it("turns the instant the input arrives, without waiting for the foot to land", () => {
    const stepping = advancePlayer(createPlayer(START), east, 0, OPEN).player;
    const turned = advancePlayer(stepping, north, STEP_MS / 2, OPEN).player;

    // He is still sliding east - the committed step is not interrupted - but he
    // already faces north, which is what a player reads as the game hearing him.
    expect(turned.facing).toBe("back");
    expect(turned.motion).toBe("step");
    expect(turned.pose).toEqual(stepping.pose);
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

  it("slide both axes together through a diagonal", () => {
    let player = advancePlayer(createPlayer(START), walk("northwest"), 0, OPEN).player;
    player = advancePlayer(player, NOTHING, DIAGONAL_STEP_MS / 2, OPEN).player;

    expect(scrollPhase(player).x).toBeCloseTo(-0.5, 6);
    expect(scrollPhase(player).y).toBeCloseTo(0.5, 6);
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

  it("lands on the committed pose at the end of a diagonal", () => {
    const started = advancePlayer(createPlayer(START), walk("southeast"), 0, OPEN).player;
    const done = advancePlayer(started, NOTHING, DIAGONAL_STEP_MS - 1, OPEN).player;
    const live = livePose(done, R);

    // Within a hundredth of a tile of the pose the step committed to - the gap
    // is the last frame of arc still unwalked, not a drift.
    expect(Math.abs(live.x - started.pose.x)).toBeLessThan(0.01);
    expect(Math.abs(live.y - started.pose.y)).toBeLessThan(0.01);
  });
});

describe("stepProgress and walkClipMs", () => {
  it("is 1 whenever no step is running", () => {
    expect(stepProgress(createPlayer(START))).toBe(1);
  });

  it("leads the next stride with the other leg", () => {
    const first = { ...createPlayer(START), motion: "step" as const, motionMs: 0, steps: 0 };
    const second = { ...first, steps: 1 };

    expect(walkClipMs(first, 400)).toBe(0);
    expect(walkClipMs(second, 400)).toBe(200);
  });
});

describe("attacking", () => {
  it("runs the sword arm's own clock for exactly as long as the swing lasts", () => {
    const swinging = advancePlayer(createPlayer(START), { attack: true }, 0, OPEN);
    expect(swinging.attacked).toBe(true);
    expect(attackProgress(swinging.player)).toBe(0);

    const mid = advancePlayer(swinging.player, { attack: true }, ATTACK_MS - 1, OPEN);
    expect(attackProgress(mid.player)).toBeCloseTo((ATTACK_MS - 1) / ATTACK_MS, 5);
    // One swing, one report - the queue is not spent again mid-animation.
    expect(mid.attacked).toBe(false);

    const settled = advancePlayer(mid.player, NOTHING, 1, OPEN);
    expect(settled.player.attackMs).toBeUndefined();
    expect(attackProgress(settled.player)).toBeUndefined();
  });

  it("swings again when the button is still held after the first one lands", () => {
    const first = advancePlayer(createPlayer(START), { attack: true }, 0, OPEN).player;
    const second = advancePlayer(first, { attack: true }, ATTACK_MS, OPEN);

    expect(second.attacked).toBe(true);
    expect(second.player.attackMs).toBe(0);
  });

  it("never carries more than one swing's worth, however long the tab slept", () => {
    const first = advancePlayer(createPlayer(START), { attack: true }, 0, OPEN).player;
    expect(advancePlayer(first, { attack: true }, 10_000, OPEN).player.attackMs).toBe(ATTACK_MS);
  });

  it("leaves him standing still when he is only attacking", () => {
    const tick = advancePlayer(createPlayer(START), { attack: true }, 0, OPEN);
    expect(tick.player.motion).toBe("idle");
    expect(tick.player.pose).toEqual(START);
  });
});

describe("attacking while moving", () => {
  it("starts both on the same frame, and faces where he is going", () => {
    const tick = advancePlayer(createPlayer(START), { heading: "north", attack: true }, 0, OPEN);

    expect(tick.attacked).toBe(true);
    expect(tick.player.attackMs).toBe(0);
    expect(tick.player.motion).toBe("step");
    expect(tick.player.pose.y).toBeCloseTo(129, 9);
    expect(tick.player.facing).toBe("back");
    // The swing no longer costs him the step, so the heading is spent too.
    expect(tick.usedHeading).toBe(true);
  });

  it("swings mid-step without waiting for the foot to land", () => {
    const stepping = advancePlayer(createPlayer(START), east, 0, OPEN).player;
    const during = advancePlayer(stepping, { attack: true }, STEP_MS / 2, OPEN);

    expect(during.attacked).toBe(true);
    expect(during.player.motion).toBe("step");
    // The step is untouched: same destination, same clock.
    expect(during.player.pose).toEqual(stepping.pose);
    expect(stepProgress(during.player)).toBeCloseTo(0.5);
  });

  it("keeps walking through a swing that outlasts several steps", () => {
    let player = advancePlayer(createPlayer(START), { heading: "north", attack: true }, 0, OPEN)
      .player;
    for (let step = 0; step < 2; step += 1) {
      player = advancePlayer(player, north, STEP_MS, OPEN).player;
    }

    expect(player.pose.y).toBeCloseTo(131, 6);
    expect(player.attackMs).toBe(2 * STEP_MS);
  });

  it("lets the swing end without disturbing the step under it", () => {
    const swinging = advancePlayer(createPlayer(START), { heading: "east", attack: true }, 0, OPEN)
      .player;
    const later = advancePlayer(swinging, east, ATTACK_MS, OPEN).player;

    expect(later.attackMs).toBeUndefined();
    expect(later.motion).toBe("step");
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
