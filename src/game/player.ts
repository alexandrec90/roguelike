/**
 * The player as turn simulation: which cell, which way, and what it is busy
 * doing.
 *
 * Deterministic and Phaser-free by design — `advancePlayer` is a pure function
 * of (state, intent, elapsed, world), so the whole feel of the controls is
 * testable without a canvas, and the presentation layer can exaggerate a step
 * without being able to change where it lands.
 *
 * The grid is the unit. A press does not nudge the hero some number of pixels;
 * it commits a whole cell step that runs to completion, which is what keeps a
 * turn-based actor on the tile grid the whole world is drawn on. Sliding
 * between the two cells is the *renderer's* business (`playerPosition`), and
 * nothing here knows how many pixels a cell is.
 */

import type { Cell } from "./field";
import type { Direction } from "./keybindings";
import { SWING } from "./models";
import type { Facing } from "./rig";

/** One cell step, in ms. Short enough to feel like input, long enough to read. */
export const STEP_MS = 180;

/** An attack owns the actor until the swing it plays is over. */
export const ATTACK_MS = SWING.durationMs;

export type Activity = "idle" | "step" | "attack";

/** Row 0 is the far edge of the field, so north is a row *decrease*. */
const STEP_DELTA: Readonly<Record<Direction, { readonly dx: number; readonly dy: number }>> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 },
  east: { dx: 1, dy: 0 },
};

/**
 * The rig has a front and a back and no third drawing, so east and west are the
 * front view and its mirror — which is the whole of `flipX`'s job here.
 */
const ORIENTATION: Readonly<Record<Direction, { readonly facing: Facing; readonly flipX: boolean }>> =
  {
    north: { facing: "back", flipX: false },
    south: { facing: "front", flipX: false },
    west: { facing: "front", flipX: true },
    east: { facing: "front", flipX: false },
  };

export interface PlayerState {
  /** Where the player is, or is arriving at while `activity` is `step`. */
  readonly cell: Cell;
  /** Where the current step began; equal to `cell` whenever one is not running. */
  readonly from: Cell;
  readonly facing: Facing;
  readonly flipX: boolean;
  readonly activity: Activity;
  /** Elapsed ms in the current activity. */
  readonly activityMs: number;
  /** Completed steps, so consecutive strides can lead with alternate legs. */
  readonly steps: number;
}

/** What the player may walk on, as the simulation sees it. */
export interface World {
  readonly columns: number;
  readonly rows: number;
  readonly blocked: (column: number, row: number) => boolean;
}

export interface Intent {
  readonly direction?: Direction;
  readonly attack: boolean;
}

/**
 * One frame's outcome. The two flags are the cue to spend a queued input: a
 * press owes exactly one action, and only the frame that acts on it may
 * discharge the debt.
 */
export interface PlayerTick {
  readonly player: PlayerState;
  /** True on the frame an attack actually started. */
  readonly attacked: boolean;
  /**
   * True on the frame the direction was acted on — by stepping, or by turning
   * to face the rock that refused the step. Both spend the press: walking into
   * a wall is an answer, not a request still waiting to be granted.
   */
  readonly usedDirection: boolean;
}

export function createPlayer(cell: Cell): PlayerState {
  return {
    cell,
    from: cell,
    facing: "front",
    flipX: false,
    activity: "idle",
    activityMs: 0,
    steps: 0,
  };
}

export function activityMsOf(activity: Activity): number {
  if (activity === "step") {
    return STEP_MS;
  }
  return activity === "attack" ? ATTACK_MS : 0;
}

/** How far through a step the player is, 0 to 1; 1 whenever none is running. */
export function stepProgress(player: PlayerState): number {
  if (player.activity !== "step") {
    return 1;
  }
  return Math.min(player.activityMs / STEP_MS, 1);
}

/**
 * The fractional cell the player occupies — the one number the renderer needs.
 *
 * A step slides from `from` to `cell` over `STEP_MS`; between steps the two are
 * the same cell and this is exactly integral.
 */
export function playerPosition(player: PlayerState): {
  readonly column: number;
  readonly row: number;
} {
  const t = stepProgress(player);
  return {
    column: player.from.column + (player.cell.column - player.from.column) * t,
    row: player.from.row + (player.cell.row - player.from.row) * t,
  };
}

/**
 * Where in the walk cycle to sample, so the second stride leads with the other
 * leg instead of replaying the first — a whole clip's worth of variety for one
 * counter, rather than a second clip.
 */
export function walkClipMs(player: PlayerState, cycleMs: number): number {
  const half = cycleMs / 2;
  return (player.steps % 2) * half + stepProgress(player) * half;
}

export function passable(world: World, column: number, row: number): boolean {
  if (column < 0 || row < 0 || column >= world.columns || row >= world.rows) {
    return false;
  }
  return !world.blocked(column, row);
}

/**
 * Age the current activity, and start the next one the moment it is free.
 *
 * A committed action is never interrupted: input that arrives mid-step or
 * mid-swing is read again on the frame it ends. The overshoot past the end of
 * an action carries into the next one, so a held direction produces an even
 * stride rather than a stutter at every frame boundary.
 */
export function advancePlayer(
  player: PlayerState,
  intent: Intent,
  deltaMs: number,
  world: World,
): PlayerTick {
  const activityMs = player.activityMs + Math.max(deltaMs, 0);
  const locked = activityMsOf(player.activity);
  if (activityMs < locked) {
    return { player: { ...player, activityMs }, attacked: false, usedDirection: false };
  }

  const settled: PlayerState = {
    ...player,
    from: player.cell,
    activity: "idle",
    activityMs: 0,
    steps: player.steps + (player.activity === "step" ? 1 : 0),
  };
  const carry = player.activity === "idle" ? 0 : Math.min(activityMs - locked, locked);
  return begin(settled, intent, carry, world);
}

/** What an idle player does with the intent it is handed. */
function begin(
  player: PlayerState,
  intent: Intent,
  carry: number,
  world: World,
): PlayerTick {
  const oriented =
    intent.direction === undefined ? player : { ...player, ...ORIENTATION[intent.direction] };

  if (intent.attack) {
    return {
      player: { ...oriented, activity: "attack", activityMs: carry },
      attacked: true,
      usedDirection: false,
    };
  }
  if (intent.direction === undefined) {
    return { player, attacked: false, usedDirection: false };
  }

  const delta = STEP_DELTA[intent.direction];
  const target: Cell = {
    column: player.cell.column + delta.dx,
    row: player.cell.row + delta.dy,
  };
  if (!passable(world, target.column, target.row)) {
    // Walked into rock or off the field: turn to face it and stay put, rather
    // than marching on the spot against something that will never give.
    return { player: oriented, attacked: false, usedDirection: true };
  }
  return {
    player: { ...oriented, from: player.cell, cell: target, activity: "step", activityMs: carry },
    attacked: false,
    usedDirection: true,
  };
}
