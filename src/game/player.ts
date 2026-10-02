/**
 * The player as movement simulation: where on the planet, facing which way, and
 * what he is doing with his sword arm while he gets there.
 *
 * Where he faces and where he goes are separate inputs - this is a twin-stick
 * game - so `Intent` carries an `aim` beside the `heading`, and facing reads
 * the aim whenever there is one.
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

import { advanceTrack } from "./hero/action-track";
import { HEADING_VECTOR, isDiagonal, type Heading } from "./keybindings";
import { CAST, SWING } from "./models";
import {
  applyGait,
  DEFAULT_STRAFE_RADIUS,
  type Gait,
  type PlanetPoint,
  type PlanetPose,
} from "./planet";

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

/** Where in the swing the blade meets its target: the clip's contact key. */
export const SWING_CONTACT_MS = Math.round(SWING.durationMs * 0.45);

/**
 * How long the hands rest between two casts. Holding the button fires at the
 * clip's length plus this — a steady rhythm rather than a stream — and it is
 * what separates "cast" from "hold to channel".
 */
export const CAST_COOLDOWN_MS = 160;

/** The casting hands are busy for the clip and the rest after it. */
export const CAST_CYCLE_MS = CAST.durationMs + CAST_COOLDOWN_MS;

/** Where in the cast the spell leaves the hands: the clip's release key. */
export const CAST_RELEASE_MS = Math.round(CAST.durationMs * 0.55);

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
 * How far the rig is turned to face a heading on screen: the one place a
 * heading becomes a facing.
 *
 * A turn, not a choice between drawings. The rig is 3D, so every one of the
 * eight is the same skeleton rotated about its vertical axis - south faces the
 * viewer, east is a quarter turn, north a half - and the sword stays in the
 * same hand all the way round, because a rotation cannot swap hands the way a
 * mirror does.
 *
 * Facing is about the *sprite*, not the pose: the camera is bolted to the
 * heading, so the hero is drawn stepping sideways out of a frame that is itself
 * swinging round. The two are allowed to disagree, and a hero who turned his
 * shoulders to walk right would fight a camera that had already turned.
 */
export function facingYaw(facing: Heading): number {
  const { dx, dy } = HEADING_VECTOR[facing];
  return Math.atan2(dx, dy);
}

/**
 * Which way the hero looks, as the turn of his rig: radians about the vertical
 * axis, 0 facing the viewer and a quarter turn clockwise for east - the
 * convention `facingYaw` writes a heading in.
 *
 * An angle rather than a `Heading` because the rig never needed the eight: it is
 * one skeleton turned, so any yaw costs the same to draw as one of the eight,
 * and the mouse points at any of them. Only a key press is snapped, because a
 * key *is* one of the eight.
 */
export type Facing = number;

export interface PlayerState {
  /** Where the current step lands; equal to `from` whenever one is not running. */
  readonly pose: PlanetPose;
  /** Where the current step began - and the pose the world is drawn from. */
  readonly from: PlanetPose;
  /** What the running step is walking; absent whenever one is not running. */
  readonly gait?: Gait;
  /** Which way the sprite looks on screen - the aim, or failing one the heading. */
  readonly facing: Facing;
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
  /** Elapsed ms in the cast and its cooldown, or `undefined` when the hands are free. */
  readonly castMs: number | undefined;
  /**
   * The last heading asked for - where he last *walked*. It is not where he
   * points: a blow or a spell goes along `facing`, the aim, which is the whole
   * of a twin-stick game.
   */
  readonly heading: Heading;
  /** Whether the blade is burning — simulation state, because it changes damage. */
  readonly enchanted: boolean;
  /** Which spell the cast in flight throws: decided on the frame it starts. */
  readonly school: "fire" | "frost";
}

/** What the player may walk on, as the simulation sees it. */
export interface World {
  /** Radius of the sideways circle, in tiles. */
  readonly radius: number;
  readonly blocked: (point: PlanetPoint) => boolean;
}

export interface Intent {
  /** Where he is told to go. */
  readonly heading?: Heading;
  /**
   * Where he is told to look - the second stick. When present it owns facing
   * outright, so he can walk north while facing south; when absent he faces
   * the way he walks. Any angle, not one of eight: the cursor is free.
   */
  readonly aim?: Facing;
  readonly attack: boolean;
  readonly cast?: boolean;
  /** The frost nova: the same hands and track as `cast`, a different spell. */
  readonly frost?: boolean;
  /** A press of enchant: toggles the blade's fire, once. */
  readonly enchant?: boolean;
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
  /** True on the frame a cast started — the cue to spend a queued cast. */
  readonly cast: boolean;
  /** True on the frame the enchant press was acted on (the blade toggled). */
  readonly toggled: boolean;
  /** True on the frame the swing reached its contact beat: a strike lands now. */
  readonly struck: boolean;
  /** True on the frame the cast reached its release beat: the spell leaves now. */
  readonly released: boolean;
}

export function createPlayer(pose: PlanetPose): PlayerState {
  return {
    pose,
    from: pose,
    facing: facingYaw("south"),
    motion: "idle",
    motionMs: 0,
    steps: 0,
    attackMs: undefined,
    castMs: undefined,
    heading: "south",
    enchanted: false,
    school: "fire",
  };
}

/** How far through the cast he is, 0 to 1, or `undefined` when the hands are free. */
export function castProgress(player: PlayerState): number | undefined {
  return player.castMs === undefined ? undefined : Math.min(player.castMs / CAST.durationMs, 1);
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
  const oriented = {
    ...player,
    facing: intent.aim ?? (intent.heading === undefined ? player.facing : facingYaw(intent.heading)),
    heading: intent.heading ?? player.heading,
  };
  const toggled = intent.enchant === true;

  // The sword arm and the casting hands: two clocks that know nothing about
  // the legs or each other. Each runs to its end, and a button still held when
  // it does starts the next on the same frame with the overshoot carried.
  const swing = advanceTrack(oriented.attackMs, intent.attack, delta, ATTACK_MS, SWING_CONTACT_MS);
  const casting = intent.cast === true || intent.frost === true;
  const cast = advanceTrack(oriented.castMs, casting, delta, CAST_CYCLE_MS, CAST_RELEASE_MS);
  // A fireball wins a tie: the school is fixed when the hands start moving.
  const school = cast.started ? (intent.cast === true ? "fire" : "frost") : oriented.school;
  const armed: PlayerState = {
    ...oriented,
    attackMs: swing.ms,
    castMs: cast.ms,
    school,
    enchanted: toggled ? !oriented.enchanted : oriented.enchanted,
  };
  const moved = advanceMotion(armed, intent, delta, world);
  return {
    player: moved.player,
    attacked: swing.started,
    usedHeading: moved.usedHeading,
    cast: cast.started,
    toggled,
    struck: swing.beat,
    released: cast.beat,
  };
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
