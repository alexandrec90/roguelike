/**
 * Whether the hero is under the sky or inside a cave, and the change between.
 *
 * Pure: a state, where he stands, and the clock in; the next state out. The
 * scene asks it once a frame and everything else - which layers draw, what
 * the horizon shows, what stops him walking - reads the answer.
 *
 * A mouth is the way in *and* the way out, so standing on it would flip him
 * back and forth every frame. The fix is that a mouth only fires on arrival:
 * once he has gone through, it is spent (`armed` false) until he has stepped
 * off it. Nothing fires while a transition is in flight either, so the
 * horizon is never asked to change its mind halfway through a change.
 */

import { OUTDOORS } from "./backdrop";
import { caveMouthAt, inMouth, type Cave } from "./caves";
import { beginTransition, transitionDone, transitionProgress, type HorizonTransition } from "./horizon-transition";
import type { PlanetPoint } from "./planet";

/** The id the cave's backdrop answers to (`cave-backdrop.ts`). */
export const CAVE = "cave";

export interface RealmState {
  /** The cave he is inside, or undefined under the sky. */
  readonly cave: Cave | undefined;
  /** Whether stepping into a mouth will take him through it. */
  readonly armed: boolean;
  /** The change of horizon in flight, if one is. */
  readonly transition: HorizonTransition | undefined;
}

export const OUTSIDE: RealmState = { cave: undefined, armed: true, transition: undefined };

/** The next state, for the hero standing at `at` at `nowMs`. Returns `state` itself when nothing changed. */
export function stepRealm(state: RealmState, at: PlanetPoint, nowMs: number): RealmState {
  if (state.transition !== undefined) {
    if (!transitionDone(state.transition, nowMs)) {
      return state;
    }
    state = { ...state, transition: undefined };
  }
  const mouth = state.cave === undefined ? caveMouthAt(at) : inMouth(state.cave, at) ? state.cave : undefined;
  if (mouth === undefined) {
    return state.armed ? state : { ...state, armed: true };
  }
  if (!state.armed) {
    return state;
  }
  const entering = state.cave === undefined;
  return {
    cave: entering ? mouth : undefined,
    armed: false,
    transition: beginTransition(entering ? OUTDOORS : CAVE, entering ? CAVE : OUTDOORS, "dissolve", nowMs),
  };
}

/** How far inside he is, 0 under the sky .. 1 in the cave - the transition's progress, signed by its direction. */
export function caveShare(state: RealmState, nowMs: number): number {
  if (state.transition === undefined) {
    return state.cave === undefined ? 0 : 1;
  }
  const progress = transitionProgress(state.transition, nowMs);
  return state.transition.to === CAVE ? progress : 1 - progress;
}
