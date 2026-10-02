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
 * **Movement is free.** A held direction walks at `WALK_TILES_PER_MS` for
 * exactly as long as it is held: release and he stops on that frame, press the
 * other way and he turns round on that frame. There used to be a committed
 * tile per press, and that commitment - up to 180 ms, 255 on a diagonal, before
 * a new direction or a release was heard - was the lag a player felt.
 *
 * What a walk *does* is the planet's (`planet.ts`): two walks over a pose,
 *
 * | Push  | Walk     | Heading                                |
 * | ----- | -------- | -------------------------------------- |
 * | north | forward+ | unchanged                              |
 * | south | forward- | unchanged                              |
 * | east  | strafe+  | turns right by `1 / radius` rad a tile |
 * | west  | strafe-  | turns left  by `1 / radius` rad a tile |
 *
 * So walking sideways is the only thing that turns the world. A diagonal is
 * both walks at once (`Gait`), each at `1/√2` of the speed, so eight-way
 * movement has one speed.
 *
 * **The renderer still sees whole tiles plus a remainder.** The hero's place is
 * an `anchor` pose and an `offset` from it of less than a tile on each axis.
 * The world is *sampled* from the anchor and *drawn* shifted by the offset, and
 * when the offset passes a whole tile the anchor walks that tile and the offset
 * gives it back - the two cancel, exactly as a finished step's did. That is
 * what lets free movement reuse every layer unchanged. Three views come out:
 * `groundPose` (the anchor), `scrollPhase` (the offset) and `livePose` (the
 * anchor walked by the offset: the continuous truth the horizon shows).
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

/** Milliseconds to walk one tile: the walking speed, and one stride of the walk cycle. */
export const STEP_MS = 180;

/** Walking speed, tiles per millisecond, along any of the eight headings. */
export const WALK_TILES_PER_MS = 1 / STEP_MS;

/**
 * How far ahead of his feet the ground must be open, in tiles, along each axis
 * he is walking. Rock is refused at this distance rather than at his feet, so
 * he stops against a cliff instead of standing half inside it.
 */
export const REACH_TILES = 0.4;

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
export type Motion = "idle" | "walk";

/** Tiles on each axis: +x is a strafe right, +y is forward. */
export interface TileOffset {
  readonly x: number;
  readonly y: number;
}

const STILL: TileOffset = { x: 0, y: 0 };

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

export interface PlayerState {
  /** The whole-tile pose the world is sampled from; it moves a tile at a time. */
  readonly anchor: PlanetPose;
  /** How far he stands from the anchor, under a tile on each axis. */
  readonly offset: TileOffset;
  /** What he is walking this frame; absent while he stands. */
  readonly gait?: Gait;
  /** How far he walked this frame, in tiles - what a thing left on the ground slides by. */
  readonly stepped: TileOffset;
  /** Which way the sprite looks on screen - the aim, or failing one the heading. */
  readonly facing: Heading;
  readonly motion: Motion;
  /** Tiles walked in all, which is where in the walk cycle his legs are. */
  readonly walked: number;
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
   * the way he walks.
   */
  readonly aim?: Heading;
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
   * True on the frame the heading was acted on - by walking, or by turning to
   * face the rock that refused him. Both spend a queued tap: walking into a
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
    anchor: pose,
    offset: STILL,
    stepped: STILL,
    facing: "south",
    motion: "idle",
    walked: 0,
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

/** How far through the swing he is, 0 to 1, or `undefined` when not swinging. */
export function attackProgress(player: PlayerState): number | undefined {
  return player.attackMs === undefined ? undefined : Math.min(player.attackMs / ATTACK_MS, 1);
}

/**
 * The pose the ground is sampled from: whole tiles only.
 *
 * Sampling from the live pose would flip a tile's terrain the instant the hero
 * crossed the half-tile that rounds to the next sample, which is a pop in the
 * middle of a stride. The anchor moves a whole tile at the instant the offset
 * gives that tile back, so the two cancel and nothing on the ground jumps.
 */
export function groundPose(player: PlayerState): PlanetPose {
  return player.anchor;
}

/** How far the world has slid out from under the hero, in tiles: under one on each axis. */
export function scrollPhase(player: PlayerState): TileOffset {
  return player.offset;
}

/**
 * Where the hero actually is: the anchor walked by the offset.
 *
 * Only the horizon reads this. Everything standing on the ground is drawn from
 * `groundPose` plus `scrollPhase` so that it all moves as one rigid picture; the
 * horizon is infinitely far away, has no grid to be quantised onto, and so gets
 * to show the turn continuously.
 */
export function livePose(player: PlayerState, radius: number = DEFAULT_STRAFE_RADIUS): PlanetPose {
  return walkFrom(player.anchor, player.offset, radius);
}

/**
 * Where in the walk cycle to sample: one stride per tile, the second leading
 * with the other leg, so the feet keep pace with the ground at any speed.
 */
export function walkClipMs(player: PlayerState, cycleMs: number): number {
  const strides = ((player.walked % 2) + 2) % 2;
  return (strides / 2) * cycleMs;
}

function walkFrom(anchor: PlanetPose, offset: TileOffset, radius: number): PlanetPose {
  if (offset.x === 0 && offset.y === 0) {
    return anchor;
  }
  return applyGait(anchor, { forward: offset.y, strafe: offset.x }, radius);
}

export function passable(world: World, point: PlanetPoint): boolean {
  return !world.blocked(point);
}

/**
 * One frame: turn to face the input, walk, age the action tracks, and start
 * whatever each of them is free to start.
 *
 * Nothing waits for anything. The legs answer the input on the frame it
 * arrives; within the sword's and the hands' tracks a committed action runs to
 * completion, and the overshoot past its end carries into the next one, so a
 * held button gives an even rhythm rather than a stutter.
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
    facing: intent.aim ?? intent.heading ?? player.facing,
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

/**
 * The legs, which know nothing about the sword: walk this frame's share of the
 * heading, or stand.
 *
 * A diagonal asks for two walks at once, so one rock in the corner must not
 * stop him dead: try the pair, then each walk on its own, and only refuse when
 * every one of them is rock. Sliding along a wall rather than sticking to it is
 * what a player pushing a stick into it expects.
 */
function advanceMotion(
  player: PlayerState,
  intent: Intent,
  delta: number,
  world: World,
): { readonly player: PlayerState; readonly usedHeading: boolean } {
  const standing: PlayerState = { ...player, motion: "idle", gait: undefined, stepped: STILL };
  if (intent.heading === undefined) {
    return { player: standing, usedHeading: false };
  }
  const full = gaitOf(intent.heading);
  // Each axis of a diagonal at 1/√2, so every heading walks at one speed.
  const share = delta * WALK_TILES_PER_MS * (isDiagonal(intent.heading) ? Math.SQRT1_2 : 1);
  const candidates: Gait[] = [full];
  if (isDiagonal(intent.heading)) {
    candidates.push({ forward: full.forward, strafe: 0 }, { forward: 0, strafe: full.strafe });
  }
  for (const gait of candidates) {
    const stepped = { x: gait.strafe * share, y: gait.forward * share };
    const offset = { x: player.offset.x + stepped.x, y: player.offset.y + stepped.y };
    if (passable(world, ahead(player.anchor, offset, gait, world.radius))) {
      const settled = settle(player.anchor, offset, world.radius);
      return {
        player: {
          ...player,
          ...settled,
          gait,
          stepped,
          motion: "walk",
          walked: player.walked + Math.hypot(stepped.x, stepped.y),
        },
        usedHeading: true,
      };
    }
  }
  // Walked into rock: he has already turned to face it, so stand rather than
  // march on the spot against something that will never give.
  return { player: standing, usedHeading: true };
}

/** The ground `REACH_TILES` ahead of where he would stand, along each axis he walks. */
function ahead(anchor: PlanetPose, offset: TileOffset, gait: Gait, radius: number): PlanetPose {
  return walkFrom(
    anchor,
    { x: offset.x + Math.sign(gait.strafe) * REACH_TILES, y: offset.y + Math.sign(gait.forward) * REACH_TILES },
    radius,
  );
}

/**
 * Hand whole tiles of offset to the anchor until under a tile is left on each
 * axis. Forward first, then strafe: the same order `applyGait` walks them in.
 */
function settle(
  anchor: PlanetPose,
  offset: TileOffset,
  radius: number,
): { readonly anchor: PlanetPose; readonly offset: TileOffset } {
  const forward = Math.trunc(offset.y);
  const strafe = Math.trunc(offset.x);
  if (forward === 0 && strafe === 0) {
    return { anchor, offset };
  }
  return {
    anchor: nextAnchor(anchor, forward, strafe, radius),
    offset: { x: offset.x - strafe, y: offset.y - forward },
  };
}

const WALKS = new WeakMap<PlanetPose, Map<string, PlanetPose>>();

/**
 * The anchor a whole-tile walk from `anchor` lands on - the same object every
 * time it is asked for. Every layer keys its per-anchor work on the pose
 * object, so this is what lets the work for the next anchor be done before
 * the hero gets there (`upcomingAnchor`): the pose the scene prepared for is
 * the very pose `settle` then hands over.
 */
export function nextAnchor(anchor: PlanetPose, forward: number, strafe: number, radius: number): PlanetPose {
  let walks = WALKS.get(anchor);
  if (walks === undefined) {
    walks = new Map();
    WALKS.set(anchor, walks);
  }
  const key = `${forward},${strafe},${radius}`;
  let next = walks.get(key);
  if (next === undefined) {
    next = applyGait(anchor, { forward, strafe }, radius);
    walks.set(key, next);
  }
  return next;
}

/** The anchor the hero is walking into, and how soon he gets there. */
export interface UpcomingAnchor {
  readonly pose: PlanetPose;
  readonly inMs: number;
}

/**
 * Where the anchor moves next if he keeps walking as he is, or undefined while
 * he stands. Each axis he walks crosses a whole tile when its offset reaches
 * ±1; the first to get there decides the next anchor, and an axis that gets
 * there within a frame of it goes with it, as a diagonal does.
 */
export function upcomingAnchor(player: PlayerState, radius: number, frameMs = 17): UpcomingAnchor | undefined {
  const { gait, offset } = player;
  if (gait === undefined || player.motion !== "walk") {
    return undefined;
  }
  const speed = WALK_TILES_PER_MS * (gait.forward !== 0 && gait.strafe !== 0 ? Math.SQRT1_2 : 1);
  // From `from` to the tile edge at `sign` (±1) is 1 - from·sign tiles.
  const msTo = (from: number, sign: number): number => (sign === 0 ? Number.POSITIVE_INFINITY : (1 - from * sign) / speed);
  const forwardMs = msTo(offset.y, Math.sign(gait.forward));
  const strafeMs = msTo(offset.x, Math.sign(gait.strafe));
  const inMs = Math.min(forwardMs, strafeMs);
  const forward = forwardMs <= inMs + frameMs ? Math.sign(gait.forward) : 0;
  const strafe = strafeMs <= inMs + frameMs ? Math.sign(gait.strafe) : 0;
  return { pose: nextAnchor(player.anchor, forward, strafe, radius), inMs };
}
