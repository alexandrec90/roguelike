/**
 * The hero as a simulation: what is held, what he does about it, and the blows
 * and spells that came of it - with no idea what he looks like.
 *
 * This is the half of `hero-layer.ts` every skin needs and none may redo. The
 * pixel skin wraps it in surfaces; the low-poly skin wraps it in a mesh. Both
 * read the same `PlayerState`, so a skin can change how he looks and never how
 * far he walks or when his sword lands.
 *
 * One call a frame, `step(delta)`, and it must come before anything reads
 * `whereabouts()`: the frame is built from where he has got to.
 */

import {
  createControls,
  currentAim,
  nextHeading,
  spendAttack,
  spendCast,
  spendEnchant,
  spendFrost,
  spendHeading,
  wantsAttack,
  wantsCast,
  wantsEnchant,
  wantsFrost,
  type ControlState,
} from "../controls";
import type { Strike } from "../combat";
import { blockedGround } from "../lakes";
import { DEFAULT_STRAFE_RADIUS, type PlanetPoint, type PlanetPose } from "../planet";
import {
  advancePlayer,
  createPlayer,
  groundPose,
  livePose,
  scrollPhase,
  upcomingAnchor,
  type PlayerState,
  type PlayerTick,
  type UpcomingAnchor,
  type World,
} from "../player";
import { MAX_STEP_MS } from "../spark-emitter";
import { castEvent, swingStrike, type CastEvent } from "./hero-actions";

/**
 * The views of the hero's pose a frame is built from: the pose the world is
 * sampled from (it moves a whole tile at a time), how far the world has slid
 * out from under him in tiles, the continuous heading, and the anchor he is
 * walking into.
 */
export interface Whereabouts {
  readonly ground: PlanetPose;
  readonly phase: { readonly x: number; readonly y: number };
  readonly turn: number;
  readonly upcoming: UpcomingAnchor | undefined;
  /** Where he actually is on the planet - what decides how deep the water round him is. */
  readonly at: PlanetPose;
  /** Tiles walked in all: where his footfalls are. */
  readonly walked: number;
}

export class HeroDriver {
  readonly controls: ControlState = createControls();
  readonly world: World;
  private state: PlayerState;
  private strikes: Strike[] = [];
  private casts: CastEvent[] = [];

  /**
   * `blocked` is what stops him walking: the overworld's lakes and land unless
   * the scene says otherwise - a cave's wall while he is inside one
   * (`cave-realm-layer.ts`).
   */
  constructor(
    start: PlanetPose,
    radius: number = DEFAULT_STRAFE_RADIUS,
    blocked: (point: PlanetPoint) => boolean = blockedGround,
  ) {
    this.state = createPlayer(start);
    this.world = { radius, blocked };
  }

  get player(): PlayerState {
    return this.state;
  }

  /**
   * One frame of simulation: read what is held, let each track commit to an
   * action, and turn the beats that fired into strikes and casts.
   *
   * The delta is clamped for the same reason an emitter's is - a backgrounded
   * tab must not resolve four seconds of walking in a single step.
   */
  step(delta: number): PlayerTick {
    const clamped = Math.min(Math.max(delta, 0), MAX_STEP_MS);
    const tick = advancePlayer(
      this.state,
      {
        heading: nextHeading(this.controls),
        aim: currentAim(this.controls),
        attack: wantsAttack(this.controls),
        cast: wantsCast(this.controls),
        frost: wantsFrost(this.controls),
        enchant: wantsEnchant(this.controls),
      },
      clamped,
      this.world,
    );
    this.state = tick.player;
    this.spend(tick);
    const at = scrollPhase(this.state);
    // A blow or a spell goes where he points, not where he walks: twin-stick.
    if (tick.struck) {
      this.strikes.push(swingStrike(this.state.facing, at, this.state.enchanted));
    }
    if (tick.released) {
      this.casts.push(castEvent(this.state.facing, at, this.state.school));
    }
    return tick;
  }

  /** Blows landed at the swing's contact beat since the last call, local tiles of the ground pose. */
  drainStrikes(): Strike[] {
    const strikes = this.strikes;
    this.strikes = [];
    return strikes;
  }

  /** Spells released at the cast's release beat since the last call. */
  drainCasts(): CastEvent[] {
    const casts = this.casts;
    this.casts = [];
    return casts;
  }

  /** Where the world has got to under him. */
  whereabouts(): Whereabouts {
    const live = livePose(this.state, this.world.radius);
    return {
      ground: groundPose(this.state),
      phase: scrollPhase(this.state),
      turn: live.turn,
      upcoming: upcomingAnchor(this.state, this.world.radius),
      at: live,
      walked: this.state.walked,
    };
  }

  /** Spend each queued input the frame acted on: a press owes exactly one action. */
  private spend(tick: PlayerTick): void {
    if (tick.attacked) {
      spendAttack(this.controls);
    }
    if (tick.cast) {
      spendCast(this.controls);
      spendFrost(this.controls);
    }
    if (tick.toggled) {
      spendEnchant(this.controls);
    }
    if (tick.usedHeading) {
      spendHeading(this.controls);
    }
  }
}
