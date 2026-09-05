import { describe, expect, it } from "vitest";

import {
  advancePlayer,
  attackProgress,
  clampToRows,
  ATTACK_MS,
  DIAGONAL_STEP_MS,
  createPlayer,
  passable,
  playerPosition,
  STEP_MS,
  stepDurationMs,
  stepProgress,
  walkClipMs,
  type Intent,
  type PlayerState,
  type World,
} from "./player";

/** A small open field with one rock in it, at column 5, row 5. */
const WORLD: World = {
  columns: 20,
  rows: 15,
  blocked: (column, row) => column === 5 && row === 5,
};

const START = { column: 10, row: 11 } as const;

function walk(heading: Intent["heading"]): Intent {
  return { heading, attack: false };
}

const STILL: Intent = { attack: false };

/** Run one intent for a whole number of frames of `deltaMs`. */
function run(player: PlayerState, intent: Intent, deltaMs: number, frames: number): PlayerState {
  let current = player;
  for (let frame = 0; frame < frames; frame += 1) {
    current = advancePlayer(current, intent, deltaMs, WORLD).player;
  }
  return current;
}

describe("a player standing still", () => {
  it("starts idle on its cell, with nothing in flight", () => {
    const player = createPlayer(START);
    expect(player.motion).toBe("idle");
    expect(playerPosition(player)).toEqual({ column: 10, row: 11 });
    expect(stepProgress(player)).toBe(1);
  });

  it("stays exactly where it is while no direction is held", () => {
    const player = run(createPlayer(START), STILL, 16, 60);
    expect(player.cell).toEqual(START);
    expect(player.motion).toBe("idle");
  });
});

describe("stepping", () => {
  it("commits a whole cell the moment a direction is pressed", () => {
    const player = advancePlayer(createPlayer(START), walk("east"), 0, WORLD).player;
    expect(player.motion).toBe("step");
    expect(player.from).toEqual(START);
    expect(player.cell).toEqual({ column: 11, row: 11 });
  });

  it("slides between the two cells, and lands on whole numbers", () => {
    const started = advancePlayer(createPlayer(START), walk("east"), 0, WORLD).player;
    const halfway = advancePlayer(started, walk("east"), STEP_MS / 2, WORLD).player;
    expect(stepProgress(halfway)).toBeCloseTo(0.5);
    expect(playerPosition(halfway)).toEqual({ column: 10.5, row: 11 });

    const landed = advancePlayer(halfway, STILL, STEP_MS / 2, WORLD).player;
    expect(landed.motion).toBe("idle");
    expect(playerPosition(landed)).toEqual({ column: 11, row: 11 });
  });

  it("goes north away from the camera — row 0 is the far edge", () => {
    const player = advancePlayer(createPlayer(START), walk("north"), 0, WORLD).player;
    expect(player.cell).toEqual({ column: 10, row: 10 });
  });

  it("keeps walking while the direction is held", () => {
    const player = run(createPlayer(START), walk("south"), STEP_MS, 3);
    expect(player.cell).toEqual({ column: 10, row: 14 });
  });

  it("finishes the step it is in before it takes a new direction", () => {
    const started = advancePlayer(createPlayer(START), walk("east"), 0, WORLD).player;
    const interrupted = advancePlayer(started, walk("north"), STEP_MS / 2, WORLD).player;
    expect(interrupted.cell).toEqual({ column: 11, row: 11 });
    expect(interrupted.motion).toBe("step");

    const next = advancePlayer(interrupted, walk("north"), STEP_MS / 2, WORLD).player;
    expect(next.cell).toEqual({ column: 11, row: 10 });
  });

  it("carries the overshoot into the next step instead of stuttering", () => {
    const started = advancePlayer(createPlayer(START), walk("east"), 0, WORLD).player;
    const next = advancePlayer(started, walk("east"), STEP_MS + 20, WORLD).player;
    expect(next.motionMs).toBe(20);
    expect(next.cell).toEqual({ column: 12, row: 11 });
  });

  it("never carries more than one action's worth, however long the tab slept", () => {
    const started = advancePlayer(createPlayer(START), walk("east"), 0, WORLD).player;
    const next = advancePlayer(started, walk("east"), 10_000, WORLD).player;
    expect(next.motionMs).toBe(STEP_MS);
    expect(next.cell).toEqual({ column: 12, row: 11 });
  });

  it("does not run time backwards on a negative delta", () => {
    const started = advancePlayer(createPlayer(START), walk("east"), 0, WORLD).player;
    const aged = advancePlayer(started, walk("east"), 50, WORLD).player;
    const rewound = advancePlayer(aged, walk("east"), -100, WORLD).player;
    expect(rewound.motionMs).toBe(50);
  });

  it("alternates the leg it leads with, one half-cycle per step", () => {
    const first = advancePlayer(createPlayer(START), walk("east"), 0, WORLD).player;
    expect(walkClipMs(first, 640)).toBe(0);

    const second = advancePlayer(first, walk("east"), STEP_MS, WORLD).player;
    expect(second.steps).toBe(1);
    expect(walkClipMs(second, 640)).toBe(320);
  });
});

describe("stepping diagonally", () => {
  it("moves on both axes at once when two directions are held", () => {
    const player = advancePlayer(createPlayer(START), walk("northeast"), 0, WORLD).player;
    expect(player.from).toEqual(START);
    expect(player.cell).toEqual({ column: 11, row: 10 });
  });

  it("reaches all four corners", () => {
    const corners = [
      ["northeast", { column: 11, row: 10 }],
      ["northwest", { column: 9, row: 10 }],
      ["southeast", { column: 11, row: 12 }],
      ["southwest", { column: 9, row: 12 }],
    ] as const;
    for (const [heading, cell] of corners) {
      expect(advancePlayer(createPlayer(START), walk(heading), 0, WORLD).player.cell).toEqual(cell);
    }
  });

  it("takes root-two as long, so a zigzag is not a shortcut", () => {
    const diagonal = advancePlayer(createPlayer(START), walk("northeast"), 0, WORLD).player;
    expect(stepDurationMs(diagonal)).toBe(DIAGONAL_STEP_MS);
    expect(DIAGONAL_STEP_MS / STEP_MS).toBeCloseTo(Math.SQRT2, 2);

    // Still mid-step at the moment a cardinal one would have landed.
    const early = advancePlayer(diagonal, STILL, STEP_MS, WORLD).player;
    expect(early.motion).toBe("step");
    expect(stepProgress(early)).toBeCloseTo(STEP_MS / DIAGONAL_STEP_MS, 5);

    const landed = advancePlayer(early, STILL, DIAGONAL_STEP_MS - STEP_MS, WORLD).player;
    expect(landed.motion).toBe("idle");
    expect(playerPosition(landed)).toEqual({ column: 11, row: 10 });
  });

  it("slides along a wall it clips instead of stopping dead against it", () => {
    // The corner is rock, but the row beside it is open: take the open half.
    const above = advancePlayer(createPlayer({ column: 4, row: 4 }), walk("southeast"), 0, WORLD);
    expect(above.player.cell).toEqual({ column: 5, row: 4 });
    expect(above.usedHeading).toBe(true);

    // A full wall down column 5: the horizontal half is gone too, so it slides
    // vertically rather than refusing the step.
    const wall: World = { columns: 20, rows: 15, blocked: (column) => column === 5 };
    const along = advancePlayer(createPlayer({ column: 4, row: 5 }), walk("northeast"), 0, wall);
    expect(along.player.cell).toEqual({ column: 4, row: 4 });
  });

  it("still refuses when neither half of the diagonal is open", () => {
    const corner = advancePlayer(createPlayer({ column: 0, row: 0 }), walk("northwest"), 0, WORLD);
    expect(corner.player.cell).toEqual({ column: 0, row: 0 });
    expect(corner.player.motion).toBe("idle");
    expect(corner.usedHeading).toBe(true);
  });
});

describe("facing", () => {
  it("shows the hero's back going north and his front going south", () => {
    const north = advancePlayer(createPlayer(START), walk("north"), 0, WORLD).player;
    expect(north).toMatchObject({ facing: "back", flipX: false });

    const south = advancePlayer(north, walk("south"), STEP_MS, WORLD).player;
    expect(south).toMatchObject({ facing: "front", flipX: false });
  });

  it("reuses the same two drawings for the diagonals: back for north, mirrored for west", () => {
    const expected = [
      ["northeast", { facing: "back", flipX: false }],
      ["northwest", { facing: "back", flipX: true }],
      ["southeast", { facing: "front", flipX: false }],
      ["southwest", { facing: "front", flipX: true }],
    ] as const;
    for (const [heading, orientation] of expected) {
      const player = advancePlayer(createPlayer(START), walk(heading), 0, WORLD).player;
      expect(player).toMatchObject(orientation);
    }
  });

  it("turns the instant the input arrives, without waiting for the foot to land", () => {
    const stepping = advancePlayer(createPlayer(START), walk("east"), 0, WORLD).player;
    const turned = advancePlayer(stepping, walk("north"), STEP_MS / 2, WORLD).player;

    // He is still sliding east — the committed step is not interrupted — but he
    // already faces north, which is what a player reads as the game hearing him.
    expect(turned.facing).toBe("back");
    expect(turned.motion).toBe("step");
    expect(turned.cell).toEqual({ column: 11, row: 11 });
  });

  it("turns for a heading it cannot walk, so a wall still answers", () => {
    const beside = createPlayer({ column: 4, row: 5 });
    const blocked = advancePlayer(beside, walk("east"), 0, WORLD).player;
    expect(blocked.cell).toEqual({ column: 4, row: 5 });
    expect(blocked).toMatchObject({ facing: "front", flipX: false });
  });

  it("mirrors the front view for west, because the rig has no side drawing", () => {
    const west = advancePlayer(createPlayer(START), walk("west"), 0, WORLD).player;
    expect(west).toMatchObject({ facing: "front", flipX: true });

    const east = advancePlayer(west, walk("east"), STEP_MS, WORLD).player;
    expect(east).toMatchObject({ facing: "front", flipX: false });
  });
});

describe("what the field will not let a player do", () => {
  it("refuses rock, and the space beyond the field's edge", () => {
    expect(passable(WORLD, 5, 5)).toBe(false);
    expect(passable(WORLD, 5, 6)).toBe(true);
    expect(passable(WORLD, -1, 3)).toBe(false);
    expect(passable(WORLD, 3, -1)).toBe(false);
    expect(passable(WORLD, WORLD.columns, 3)).toBe(false);
    expect(passable(WORLD, 3, WORLD.rows)).toBe(false);
  });

  it("turns to face a rock rather than walking on the spot", () => {
    const beside = createPlayer({ column: 4, row: 5 });
    const blocked = advancePlayer(beside, walk("east"), 0, WORLD).player;
    expect(blocked.cell).toEqual({ column: 4, row: 5 });
    expect(blocked.motion).toBe("idle");
    expect(blocked.facing).toBe("front");

    const away = advancePlayer(blocked, walk("north"), 16, WORLD).player;
    expect(away.cell).toEqual({ column: 4, row: 4 });
  });

  it("stops at the edge of the field", () => {
    const atEdge = createPlayer({ column: 0, row: 0 });
    const player = run(atEdge, walk("west"), STEP_MS, 4);
    expect(player.cell).toEqual({ column: 0, row: 0 });
  });
});

describe("reporting what it did with the direction", () => {
  it("claims it on the frame the step begins, and not again while it runs", () => {
    const started = advancePlayer(createPlayer(START), walk("east"), 0, WORLD);
    expect(started.usedHeading).toBe(true);

    const during = advancePlayer(started.player, walk("east"), STEP_MS / 2, WORLD);
    expect(during.usedHeading).toBe(false);
  });

  it("claims it for a blocked press too — a wall is an answer", () => {
    const beside = createPlayer({ column: 4, row: 5 });
    const blocked = advancePlayer(beside, walk("east"), 0, WORLD);
    expect(blocked.player.cell).toEqual({ column: 4, row: 5 });
    expect(blocked.usedHeading).toBe(true);
  });

  it("claims nothing when there was no heading, or the attack won", () => {
    const still = advancePlayer(createPlayer(START), STILL, 16, WORLD);
    expect(still.usedHeading).toBe(false);

    const swung = advancePlayer(createPlayer(START), { heading: "north", attack: true }, 0, WORLD);
    // The swing no longer costs him the step, so the heading is spent either way.
    expect(swung.usedHeading).toBe(true);
  });
});

describe("attacking", () => {
  it("runs the sword arm's own clock for exactly as long as the swing lasts", () => {
    const swinging = advancePlayer(createPlayer(START), { attack: true }, 0, WORLD);
    expect(swinging.attacked).toBe(true);
    expect(attackProgress(swinging.player)).toBe(0);

    const mid = advancePlayer(swinging.player, { attack: true }, ATTACK_MS - 1, WORLD);
    expect(attackProgress(mid.player)).toBeCloseTo((ATTACK_MS - 1) / ATTACK_MS, 5);
    // One swing, one report — the queue is not spent again mid-animation.
    expect(mid.attacked).toBe(false);

    const settled = advancePlayer(mid.player, STILL, 1, WORLD);
    expect(settled.player.attackMs).toBeUndefined();
    expect(attackProgress(settled.player)).toBeUndefined();
  });

  it("swings again when the button is still held after the first one lands", () => {
    const first = advancePlayer(createPlayer(START), { attack: true }, 0, WORLD).player;
    const second = advancePlayer(first, { attack: true }, ATTACK_MS, WORLD);
    expect(second.attacked).toBe(true);
    expect(second.player.attackMs).toBe(0);
  });

  it("never carries more than one swing's worth, however long the tab slept", () => {
    const first = advancePlayer(createPlayer(START), { attack: true }, 0, WORLD).player;
    const second = advancePlayer(first, { attack: true }, 10_000, WORLD);
    expect(second.player.attackMs).toBe(ATTACK_MS);
  });

  it("leaves him standing still when he is only attacking", () => {
    const tick = advancePlayer(createPlayer(START), { attack: true }, 0, WORLD);
    expect(tick.player.motion).toBe("idle");
    expect(tick.player.cell).toEqual(START);
  });
});

describe("attacking while moving", () => {
  it("starts both on the same frame, and faces where he is going", () => {
    const tick = advancePlayer(createPlayer(START), { heading: "north", attack: true }, 0, WORLD);
    expect(tick.attacked).toBe(true);
    expect(tick.player.attackMs).toBe(0);
    expect(tick.player.motion).toBe("step");
    expect(tick.player.cell).toEqual({ column: 10, row: 10 });
    expect(tick.player.facing).toBe("back");
  });

  it("swings mid-step without waiting for the foot to land", () => {
    const stepping = advancePlayer(createPlayer(START), walk("east"), 0, WORLD).player;
    const during = advancePlayer(stepping, { attack: true }, STEP_MS / 2, WORLD);
    expect(during.attacked).toBe(true);
    expect(during.player.motion).toBe("step");
    // The step is untouched: same destination, same clock.
    expect(during.player.cell).toEqual({ column: 11, row: 11 });
    expect(stepProgress(during.player)).toBeCloseTo(0.5);
  });

  it("keeps walking through a swing that outlasts several steps", () => {
    let player = advancePlayer(createPlayer(START), { heading: "east", attack: true }, 0, WORLD)
      .player;
    for (let frame = 0; frame < 2; frame += 1) {
      player = advancePlayer(player, walk("east"), STEP_MS, WORLD).player;
    }
    // Two whole steps inside one 520 ms swing, and the swing is still running.
    expect(player.cell).toEqual({ column: 13, row: 11 });
    expect(player.attackMs).toBe(2 * STEP_MS);
  });

  it("lets the swing end without disturbing the step under it", () => {
    const swinging = advancePlayer(createPlayer(START), { heading: "east", attack: true }, 0, WORLD)
      .player;
    const later = advancePlayer(swinging, walk("east"), ATTACK_MS, WORLD).player;
    expect(later.attackMs).toBeUndefined();
    expect(later.motion).toBe("step");
  });
});

describe("a field that just got shorter", () => {
  it("leaves a player the window can still show exactly where he is", () => {
    const player = createPlayer(START);

    expect(clampToRows(player, 15)).toBe(player);
    expect(clampToRows(player, 12)).toBe(player);
  });

  it("pulls a player back onto the last row that survived the crop", () => {
    const clamped = clampToRows(createPlayer(START), 7);

    expect(clamped.cell).toEqual({ column: 10, row: 6 });
    // Clamped, not re-centred: the player put him in column 10 and a resize is
    // not a reason to move him sideways as well.
    expect(clamped.cell.column).toBe(START.column);
  });

  it("clamps the cell a step is leaving as well as the one it is entering", () => {
    // Only clamping the destination would let the slide start off the field
    // and carry him back out of view for the rest of the step.
    const stepping = advancePlayer(createPlayer(START), walk("north"), 0, WORLD).player;
    const clamped = clampToRows(stepping, 8);

    expect(clamped.from.row).toBe(7);
    expect(clamped.cell.row).toBe(7);
    expect(playerPosition(clamped).row).toBe(7);
  });

  it("keeps a row to stand on even when the window left room for none", () => {
    expect(clampToRows(createPlayer(START), 0).cell.row).toBe(0);
  });
});
