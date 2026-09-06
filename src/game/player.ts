/**
 * The player as movement simulation: where on the planet, facing which way, and
 * what he is doing with his sword arm while he gets there.
 *
 * **Two tracks, aged independently.** Locomotion and the swing are separate
 * timers over one skeleton, so an attack never costs a step and a step never
 * delays an attack - which is the whole of "attack while moving", and the
 * reason nothing here is called "the current activity" any more. The renderer
 * puts them back together by layering the clips (`hero-layer.ts`), because
 * `SWING` keys only the sword arm, the sword and the torso, and leaves the legs
 * to whatever is walking them.
 *
 * Deterministic and Phaser-free by design - `advancePlayer` is a pure function
 * of (state, intent, elapsed, world), so the whole feel of the controls is
 * testable without a canvas, and the presentation layer can exaggerate a step
 * without being able to change where it lands.
 *
 * The unit is still a whole step: a press does not nudge the hero some number
 * of pixels, it commits one tile of walking that runs to completion. What
 * changed when the world became round is what a step *is*. There is no grid to
 * step across any more and no map edge to be fenced by - there is a pose, and
 * two walks over it (`planet.ts`):
 *
 * | Push  | Stride            | Heading                          |
 * | ----- | ----------------- | -------------------------------- |
 * | north | forward  +1 tile  | unchanged                        |
 * | south | forward  -1 tile  | unchanged                        |
 * | east  | strafe   +1 tile  | turns right by `1 / radius` rad  |
 * | west  | strafe   -1 tile  | turns left  by `1 / radius` rad  |
 *
 * So walking sideways is the only thing that turns the world, and it turns it
 * whether the hero wanted to or not - that is the shape of the planet, not a
 * control decision. A diagonal is both walks at once (`Gait`) rather than a
 * fifth row in that table: the planet has no diagonal for it to be.
 *
 * Three views of the pose come out of here, and the renderer needs all three
 * for the reason `camera.ts` explains: `groundPose` is the pose the world is
 * *sampled* from (frozen for the length of a step), `scrollPhase` is the
 * sub-tile offset the picture is *drawn* at, and `livePose` is the continuous
 * truth, which only the horizon is far enough away to show.
 */

import { HEADING_VECTOR, isDiagonal, type Heading } from "./keybindings";
import { SWING } from "./models";
import {
  applyGait,
  DEFAULT_STRAFE_RADIUS,
  type Gait,
  type PlanetPoint,
  type PlanetPose,
} from "./planet";
import type { Facing } from "./rig";

/** One cell step, in ms. Short enough to feel like input, long enough to read. */
export const STEP_MS = 180;

/**
 * A diagonal crosses sqrt(2) tiles, so it is given sqrt(2) as long.
 *
 * Without this the shortest route anywhere is a zigzag: the same `STEP_MS`
 * spent covering a longer distance is 41% more speed for holding one extra key,
 * which is the oldest bug in eight-way movement.
 */
export const DIAGONAL_STEP_MS = Math.round(STEP_MS * Math.SQRT2);

/** An attack owns the sword arm until the swing it plays is over. */
export const ATTACK_MS = SWING.durationMs;

/** What the *legs* are doing. The sword arm has its own clock, `attackMs`. */
export type Motion = "idle" | "step";

/**
 * A heading as the two walks the planet actually has.
 *
 * `HEADING_VECTOR` is written in screen terms - north is *up*, which is a `dy`
 * of -1 - and forward runs up the screen, so `forward` is `-dy`. `strafe` is
 * `dx` unchanged, because right is right in both frames. This is the one place
 * the two conventions meet.
 */
export function gaitOf(heading: Heading): Gait {
  const { dx, dy } = HEADING_VECTOR[heading];
  // `dy === 0 ? 0` rather than a bare negation, because `-0` is a real number
  // in JavaScript and it would travel all the way into `scrollPhase`.
  return { forward: dy === 0 ? 0 : -dy, strafe: dx };
}

/**
 * How the hero is drawn for each of the eight headings, out of the two drawings
 * that exist.
 *
 * The rig has a front and a back and no third view, so the horizontal component
 * is a mirror (`flipX`) and the vertical one picks the drawing: anything with
 * north in it shows his back, anything else his front. Pure east and west are
 * the front view, mirrored - the placeholder that keeps all eight readable
 * without a side view being drawn.
 *
 * Facing is about the *sprite*, not the pose: the camera is bolted to the
 * heading, so the hero is drawn stepping sideways out of a frame that is itself
 * swinging round. The two are allowed to disagree, and a hero who turned his
 * shoulders to walk right would fight a camera that had already turned.
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
  /** Where the current step lands; equal to `from` whenever one is not running. */
  readonly pose: PlanetPose;
  /** Where the current step began - and the pose the world is drawn from. */
  readonly from: PlanetPose;
  /** What the running step is walking; absent whenever one is not running. */
  readonly gait?: Gait;
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
  /** Radius of the sideways circle, in tiles. */
  readonly radius: number;
  readonly blocked: (point: PlanetPoint) => boolean;
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
   * True on the frame the heading was acted on - by stepping, or by turning to
   * face the rock that refused the step. Both spend the press: walking into a
   * wall is an answer, not a request still waiting to be granted.
   */
  readonly usedHeading: boolean;
}

export function createPlayer(pose: PlanetPose): PlayerState {
  return {
    pose,
    from: pose,
    facing: "front",
    flipX: false,
    motion: "idle",
    motionMs: 0,
    steps: 0,
    attackMs: undefined,
  };
}

/**
 * How long the step in flight lasts, read off the gait it is walking rather
 * than stored - a diagonal is exactly the one that moved on both axes.
 */
export function stepDurationMs(player: PlayerState): number {
  const gait = player.gait;
  const diagonal = gait !== undefined && gait.forward !== 0 && gait.strafe !== 0;
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
 * The pose the ground is sampled from: frozen for the length of a step.
 *
 * Frozen on purpose. Sampling from the live pose would flip a tile's terrain
 * the instant the hero crossed the half-tile that rounds to the next sample,
 * which is a pop in the middle of a stride; freezing it and carrying the motion
 * in `scrollPhase` instead means the sample advances by exactly one cell at the
 * same instant the drawn offset resets by exactly one cell, and the two cancel.
 */
export function groundPose(player: PlayerState): PlanetPose {
  return player.from;
}

/**
 * How far the world has slid out from under the hero, in tiles.
 *
 * Zero between steps, and exactly one tile on each axis the step is walking by
 * the moment it completes - which is the instant `groundPose` advances by those
 * cells and takes the offset back to zero. A diagonal moves both at once, which
 * is why this was always a vector.
 */
export function scrollPhase(player: PlayerState): { readonly x: number; readonly y: number } {
  const gait = player.gait;
  if (gait === undefined || player.motion !== "step") {
    return { x: 0, y: 0 };
  }
  const walked = stepProgress(player);
  return { x: gait.strafe * walked, y: gait.forward * walked };
}

/**
 * Where the hero actually is, mid-stride and all.
 *
 * Only the horizon reads this. Everything standing on the ground is drawn from
 * `groundPose` plus `scrollPhase` so that it all moves as one rigid picture; the
 * horizon is infinitely far away, has no grid to be quantised onto, and so gets
 * to show the turn continuously.
 */
export function livePose(player: PlayerState, radius: number = DEFAULT_STRAFE_RADIUS): PlanetPose {
  const gait = player.gait;
  if (gait === undefined || player.motion !== "step") {
    return player.pose;
  }
  const walked = stepProgress(player);
  const part = { forward: gait.forward * walked, strafe: gait.strafe * walked };
  return applyGait(player.from, part, radius);
}

/**
 * Where in the walk cycle to sample, so the second stride leads with the other
 * leg instead of replaying the first - a whole clip's worth of variety for one
 * counter, rather than a second clip.
 */
export function walkClipMs(player: PlayerState, cycleMs: number): number {
  const half = cycleMs / 2;
  return (player.steps % 2) * half + stepProgress(player) * half;
}

export function passable(world: World, point: PlanetPoint): boolean {
  return !world.blocked(point);
}

/**
 * One frame: turn to face the input, age both tracks, and start whatever each
 * of them is free to start.
 *
 * The two tracks never wait for each other - that is the point. Within a track
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
 * one on the same frame - with the overshoot carried, so holding attack gives
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
    from: player.pose,
    gait: undefined,
    motion: "idle",
    motionMs: 0,
    steps: player.steps + 1,
  };
  return beginStep(landed, intent, Math.min(motionMs - duration, duration), world);
}

/**
 * The gait a heading actually walks, sliding along anything it clips.
 *
 * A diagonal asks for two walks at once, so one rock in the corner must not
 * cancel the whole step: try the pair, then each walk on its own, and only
 * refuse when every one of them is rock. Sliding along a wall rather than
 * sticking to it is what a player pushing a stick into it expects.
 *
 * `undefined` means nothing was open. There is no second case any more - a
 * round planet has no edge to walk off.
 */
function openGait(
  pose: PlanetPose,
  heading: Heading,
  world: World,
): { readonly gait: Gait; readonly target: PlanetPose } | undefined {
  const full = gaitOf(heading);
  const candidates: Gait[] = [full];
  if (isDiagonal(heading)) {
    candidates.push({ forward: full.forward, strafe: 0 }, { forward: 0, strafe: full.strafe });
  }
  for (const gait of candidates) {
    const target = applyGait(pose, gait, world.radius);
    if (passable(world, target)) {
      return { gait, target };
    }
  }
  return undefined;
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

  const open = openGait(player.pose, intent.heading, world);
  if (open === undefined) {
    // Walked into rock: he has already turned to face it, so stay put rather
    // than marching on the spot against something that will never give.
    return { player, usedHeading: true };
  }
  return {
    player: {
      ...player,
      from: player.pose,
      pose: open.target,
      gait: open.gait,
      motion: "step",
      motionMs: carry,
    },
    usedHeading: true,
  };
}
