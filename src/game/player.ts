/**
 * The player as movement simulation: which cell, which way, and what he is
 * doing with his sword arm while he gets there.
 *
 * **Two tracks, aged independently.** Locomotion and the swing are separate
 * timers over one skeleton, so an attack never costs a step and a step never
 * delays an attack — which is the whole of "attack while moving", and the
 * reason nothing here is called "the current activity" any more. The renderer
 * puts them back together by layering the clips (`hero-layer.ts`), because
 * `SWING` keys only the sword arm, the sword and the torso, and leaves the legs
 * to whatever is walking them.
 *
 * Deterministic and Phaser-free by design — `advancePlayer` is a pure function
 * of (state, intent, elapsed, world), so the whole feel of the controls is
 * testable without a canvas, and the presentation layer can exaggerate a step
 * without being able to change where it lands.
 *
 * The grid is the unit. A press does not nudge the hero some number of pixels;
 * it commits a whole cell step that runs to completion, which is what keeps the
 * actor on the tile grid the whole world is drawn on. Sliding between the two
 * cells is the *renderer's* business (`playerPosition`), and nothing here knows
 * how many pixels a cell is.
 */

import type { Cell } from "./field";
import { HEADING_VECTOR, isDiagonal, type Heading } from "./keybindings";
import { SWING } from "./models";
import type { Facing } from "./rig";

/** One cell step, in ms. Short enough to feel like input, long enough to read. */
export const STEP_MS = 180;

/**
 * A diagonal crosses √2 cells, so it is given √2 as long.
 *
 * Without this the shortest route anywhere is a zigzag: the same `STEP_MS`
 * spent covering a longer distance is 41% more speed for holding one extra key,
 * which is the oldest bug in eight-way movement.
 */
export const DIAGONAL_STEP_MS = Math.round(STEP_MS * Math.SQRT2);

/** An attack owns the actor until the swing it plays is over. */
export const ATTACK_MS = SWING.durationMs;

/** What the *legs* are doing. The sword arm has its own clock, `attackMs`. */
export type Motion = "idle" | "step";

/**
 * How the hero is drawn for each of the eight headings, out of the two drawings
 * that exist.
 *
 * The rig has a front and a back and no third view, so the horizontal component
 * is a mirror (`flipX`) and the vertical one picks the drawing: anything with
 * north in it shows his back, anything else his front. Pure east and west are
 * the front view, mirrored — the placeholder that keeps all eight readable
 * without a side view being drawn. Facing is *four* pictures over eight
 * headings, and left/right is symmetrical, which is the whole contract.
 */
const ORIENTATION: Readonly<Record<Heading, { readonly facing: Facing; readonly flipX: boolean }>> =
  {
    north: { facing: "back", flipX: false },
    south: { facing: "front", flipX: false },
    west: { facing: "front", flipX: true },
    east: { facing: "front", flipX: false },
    northeast: { facing: "back", flipX: false },
    northwest: { facing: "back", flipX: true },
    southeast: { facing: "front", flipX: false },
    southwest: { facing: "front", flipX: true },
  };

export interface PlayerState {
  /** Where the player is, or is arriving at while `motion` is `step`. */
  readonly cell: Cell;
  /** Where the current step began; equal to `cell` whenever one is not running. */
  readonly from: Cell;
  readonly facing: Facing;
  readonly flipX: boolean;
  readonly motion: Motion;
  /** Elapsed ms in the current step; 0 whenever none is running. */
  readonly motionMs: number;
  /** Completed steps, so consecutive strides can lead with alternate legs. */
  readonly steps: number;
  /**
   * Elapsed ms in the swing, or `undefined` when the sword arm is free.
   *
   * A second timer rather than a third `Motion` value: the two tracks have to
   * be able to run at once, and a single enum is exactly the thing that cannot
   * express that.
   */
  readonly attackMs: number | undefined;
}

/** What the player may walk on, as the simulation sees it. */
export interface World {
  readonly columns: number;
  readonly rows: number;
  readonly blocked: (column: number, row: number) => boolean;
}

export interface Intent {
  readonly heading?: Heading;
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
   * True on the frame the heading was acted on — by stepping, or by turning to
   * face the rock that refused the step. Both spend the press: walking into a
   * wall is an answer, not a request still waiting to be granted.
   */
  readonly usedHeading: boolean;
}

export function createPlayer(cell: Cell): PlayerState {
  return {
    cell,
    from: cell,
    facing: "front",
    flipX: false,
    motion: "idle",
    motionMs: 0,
    steps: 0,
    attackMs: undefined,
  };
}

/**
 * Pull the player back inside a field that just got shorter.
 *
 * The window decides how many rows exist (`viewport.ts`), so dragging its
 * bottom edge up can leave the hero standing on ground the crop has taken away.
 * This clamps rather than re-centres on purpose: the player put him where he
 * is, and a resize is not a reason to move him one row further than it must.
 *
 * A step in flight is clamped at both ends — the cell he is arriving at *and*
 * the one he left — because a slide that starts off the field would carry him
 * back out of view for the rest of its `STEP_MS`.
 */
export function clampToRows(player: PlayerState, rows: number): PlayerState {
  const last = Math.max(rows - 1, 0);
  if (player.cell.row <= last && player.from.row <= last) {
    return player;
  }
  return {
    ...player,
    cell: { ...player.cell, row: Math.min(player.cell.row, last) },
    from: { ...player.from, row: Math.min(player.from.row, last) },
  };
}

/**
 * How long the step in flight lasts, read off the two cells it spans rather
 * than stored — a diagonal is exactly the one that moved on both axes.
 */
export function stepDurationMs(player: PlayerState): number {
  const diagonal =
    player.cell.column !== player.from.column && player.cell.row !== player.from.row;
  return diagonal ? DIAGONAL_STEP_MS : STEP_MS;
}

/** How far through a step the player is, 0 to 1; 1 whenever none is running. */
export function stepProgress(player: PlayerState): number {
  if (player.motion !== "step") {
    return 1;
  }
  return Math.min(player.motionMs / stepDurationMs(player), 1);
}

/** How far through the swing he is, 0 to 1, or `undefined` when not swinging. */
export function attackProgress(player: PlayerState): number | undefined {
  return player.attackMs === undefined ? undefined : Math.min(player.attackMs / ATTACK_MS, 1);
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
 * One frame: turn to face the input, age both tracks, and start whatever each
 * of them is free to start.
 *
 * The two tracks never wait for each other — that is the point. Within a track
 * a committed action still runs to completion, and the overshoot past its end
 * carries into the next one, so a held direction produces an even stride and a
 * held button an even rhythm rather than a stutter at every frame boundary.
 */
export function advancePlayer(
  player: PlayerState,
  intent: Intent,
  deltaMs: number,
  world: World,
): PlayerTick {
  const delta = Math.max(deltaMs, 0);
  // Turning is free and immediate. Waiting for the foot to land before the hero
  // even *looks* the way he was told to is the difference a player reads as lag.
  const oriented =
    intent.heading === undefined ? player : { ...player, ...ORIENTATION[intent.heading] };

  const swung = advanceSwing(oriented, intent, delta);
  const moved = advanceMotion(swung.player, intent, delta, world);
  return { player: moved.player, attacked: swung.attacked, usedHeading: moved.usedHeading };
}

/**
 * The sword arm's clock, which knows nothing about the legs.
 *
 * A swing runs to its end, and a button still held when it does starts the next
 * one on the same frame — with the overshoot carried, so holding attack gives
 * an even rhythm.
 */
function advanceSwing(
  player: PlayerState,
  intent: Intent,
  delta: number,
): { readonly player: PlayerState; readonly attacked: boolean } {
  const attackMs = player.attackMs === undefined ? undefined : player.attackMs + delta;
  if (attackMs !== undefined && attackMs < ATTACK_MS) {
    return { player: { ...player, attackMs }, attacked: false };
  }
  if (!intent.attack) {
    return { player: { ...player, attackMs: undefined }, attacked: false };
  }
  const carry = attackMs === undefined ? 0 : Math.min(attackMs - ATTACK_MS, ATTACK_MS);
  return { player: { ...player, attackMs: carry }, attacked: true };
}

/** The legs' clock, which knows nothing about the sword. */
function advanceMotion(
  player: PlayerState,
  intent: Intent,
  delta: number,
  world: World,
): { readonly player: PlayerState; readonly usedHeading: boolean } {
  if (player.motion !== "step") {
    return beginStep(player, intent, 0, world);
  }

  const motionMs = player.motionMs + delta;
  const duration = stepDurationMs(player);
  if (motionMs < duration) {
    return { player: { ...player, motionMs }, usedHeading: false };
  }

  const landed: PlayerState = {
    ...player,
    from: player.cell,
    motion: "idle",
    motionMs: 0,
    steps: player.steps + 1,
  };
  return beginStep(landed, intent, Math.min(motionMs - duration, duration), world);
}

/**
 * Where a heading actually lands, sliding along anything it clips.
 *
 * A diagonal asks for two axes at once, so one rock in the corner must not
 * cancel the whole step: try the diagonal, then each axis on its own, and only
 * refuse when every one of them is rock. Sliding along a wall rather than
 * sticking to it is what a player pushing a stick into it expects.
 *
 * `undefined` means nothing was open.
 */
function stepTarget(cell: Cell, heading: Heading, world: World): Cell | undefined {
  const { dx, dy } = HEADING_VECTOR[heading];
  const candidates: Cell[] = [{ column: cell.column + dx, row: cell.row + dy }];
  if (isDiagonal(heading)) {
    candidates.push({ column: cell.column + dx, row: cell.row });
    candidates.push({ column: cell.column, row: cell.row + dy });
  }
  return candidates.find((candidate) => passable(world, candidate.column, candidate.row));
}

/** What a player with both feet on the ground does with the heading he is given. */
function beginStep(
  player: PlayerState,
  intent: Intent,
  carry: number,
  world: World,
): { readonly player: PlayerState; readonly usedHeading: boolean } {
  if (intent.heading === undefined) {
    return { player, usedHeading: false };
  }

  const target = stepTarget(player.cell, intent.heading, world);
  if (target === undefined) {
    // Walked into rock or off the field: he has already turned to face it, so
    // stay put rather than marching on the spot against something that will
    // never give.
    return { player, usedHeading: true };
  }
  return {
    player: { ...player, from: player.cell, cell: target, motion: "step", motionMs: carry },
    usedHeading: true,
  };
}
