/**
 * The player as turn simulation: where on the planet, facing which way, and
 * what he is busy doing.
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
 * four presses that move it two ways (`planet.ts`):
 *
 * | Press | Stride            | Heading                          |
 * | ----- | ----------------- | -------------------------------- |
 * | north | forward  +1 tile  | unchanged                        |
 * | south | forward  -1 tile  | unchanged                        |
 * | east  | strafe   +1 tile  | turns right by `1 / radius` rad  |
 * | west  | strafe   -1 tile  | turns left  by `1 / radius` rad  |
 *
 * So walking sideways is the only thing that turns the world, and it turns it
 * whether the hero wanted to or not - that is the shape of the planet, not a
 * control decision.
 *
 * Three views of the pose come out of here, and the renderer needs all three
 * for the reason `camera.ts` explains: `groundPose` is the pose the world is
 * *sampled* from (frozen for the length of a step), `scrollPhase` is the
 * sub-tile offset the picture is *drawn* at, and `livePose` is the continuous
 * truth, which only the horizon is far enough away to show.
 */

import type { Direction } from "./keybindings";
import { SWING } from "./models";
import {
  applyStride,
  DEFAULT_STRAFE_RADIUS,
  type PlanetPoint,
  type PlanetPose,
  type Stride,
} from "./planet";
import type { Facing } from "./rig";

/** One cell step, in ms. Short enough to feel like input, long enough to read. */
export const STEP_MS = 180;

/** An attack owns the actor until the swing it plays is over. */
export const ATTACK_MS = SWING.durationMs;

export type Activity = "idle" | "step" | "attack";

const STRIDE: Readonly<Record<Direction, Stride>> = {
  north: { gait: "forward", distance: 1 },
  south: { gait: "forward", distance: -1 },
  west: { gait: "strafe", distance: -1 },
  east: { gait: "strafe", distance: 1 },
};

/**
 * The rig has a front and a back and no third drawing, so east and west are the
 * front view and its mirror - which is the whole of `flipX`'s job here.
 *
 * Facing is about the *sprite*, not the pose: the camera is bolted to the
 * heading, so the hero is drawn stepping sideways out of a frame that is itself
 * swinging round. The two are allowed to disagree, and a hero who turned his
 * shoulders to walk right would fight a camera that had already turned.
 */
const ORIENTATION: Readonly<Record<Direction, { readonly facing: Facing; readonly flipX: boolean }>> =
  {
    north: { facing: "back", flipX: false },
    south: { facing: "front", flipX: false },
    west: { facing: "front", flipX: true },
    east: { facing: "front", flipX: false },
  };

export interface PlayerState {
  /** Where the current step lands; equal to `from` whenever one is not running. */
  readonly pose: PlanetPose;
  /** Where the current step began - and the pose the world is drawn from. */
  readonly from: PlanetPose;
  /** What the running step is doing; absent whenever one is not running. */
  readonly stride?: Stride;
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
  /** Radius of the sideways circle, in tiles. */
  readonly radius: number;
  readonly blocked: (point: PlanetPoint) => boolean;
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
   * True on the frame the direction was acted on - by stepping, or by turning
   * to face the rock that refused the step. Both spend the press: walking into
   * a wall is an answer, not a request still waiting to be granted.
   */
  readonly usedDirection: boolean;
}

export function createPlayer(pose: PlanetPose): PlayerState {
  return {
    pose,
    from: pose,
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
 * Zero between steps, and exactly one tile on the axis being walked at the
 * moment a step completes - which is the instant `groundPose` advances by one
 * cell and takes the offset back to zero.
 */
export function scrollPhase(player: PlayerState): { readonly x: number; readonly y: number } {
  const stride = player.stride;
  if (stride === undefined || player.activity !== "step") {
    return { x: 0, y: 0 };
  }
  const walked = stride.distance * stepProgress(player);
  return stride.gait === "forward" ? { x: 0, y: walked } : { x: walked, y: 0 };
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
  const stride = player.stride;
  if (stride === undefined || player.activity !== "step") {
    return player.pose;
  }
  const walked = { ...stride, distance: stride.distance * stepProgress(player) };
  return applyStride(player.from, walked, radius);
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
    from: player.pose,
    stride: undefined,
    activity: "idle",
    activityMs: 0,
    steps: player.steps + (player.activity === "step" ? 1 : 0),
  };
  const carry = player.activity === "idle" ? 0 : Math.min(activityMs - locked, locked);
  return begin(settled, intent, carry, world);
}

/** What an idle player does with the intent it is handed. */
function begin(player: PlayerState, intent: Intent, carry: number, world: World): PlayerTick {
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

  const stride = STRIDE[intent.direction];
  const target = applyStride(player.pose, stride, world.radius);
  if (!passable(world, target)) {
    // Walked into rock: turn to face it and stay put, rather than marching on
    // the spot against something that will never give. There is no second case
    // any more - a round planet has no edge to walk off.
    return { player: oriented, attacked: false, usedDirection: true };
  }
  return {
    player: {
      ...oriented,
      from: player.pose,
      pose: target,
      stride,
      activity: "step",
      activityMs: carry,
    },
    attacked: false,
    usedDirection: true,
  };
}
