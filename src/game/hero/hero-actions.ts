/**
 * What the hero's actions *do* to the world, as pure data: the strike a swing
 * lands and the spell a cast throws.
 *
 * The simulation (`player.ts`) says *when* — the frame the swing passes its
 * contact beat, the frame the cast passes its release — and this says *what*,
 * in the local frame every receiver already speaks (`combat.ts`). Neither
 * knows about slimes or fireballs; the scene hands these lists on.
 */

import type { Element, Strike } from "../combat";
import { HEADING_VECTOR, type Heading } from "../keybindings";
import type { LocalPoint } from "../planet";

/** How far in front of him the sword's blow is centred, tiles. */
export const STRIKE_REACH = 0.8;
/** The blow's radius, tiles. */
export const STRIKE_RADIUS = 0.9;
/** How hard a cut shoves what it hits, tiles per second, along his heading. */
export const STRIKE_PUSH = 5;
/** Where the hands are when a spell leaves them: this far ahead, tiles. */
export const CAST_REACH = 0.45;
/** And this high above the ground, logical pixels — chest height. */
export const CAST_HEIGHT_PX = 11;

/** A spell leaving the hero's hands: where, which way, and what it is. */
export interface CastEvent {
  /** Local tiles, like a strike: right of the hero, and ahead of him. */
  readonly from: LocalPoint;
  /** Unit vector in local tiles. */
  readonly direction: { readonly x: number; readonly y: number };
  /** Height of the hands above the ground at release, logical pixels. */
  readonly heightPx: number;
  readonly element: Element;
}

/**
 * A heading as a unit vector in the local frame.
 *
 * `HEADING_VECTOR` is screen-space (north is up, a `dy` of -1) and the local
 * frame's `y` is *ahead*, which is up the screen — so `y` is `-dy`. Diagonals
 * are normalised, so a blow toward the corner reaches no further than one
 * straight ahead.
 */
export function headingDirection(heading: Heading): { readonly x: number; readonly y: number } {
  const { dx, dy } = HEADING_VECTOR[heading];
  const length = Math.hypot(dx, dy) || 1;
  // `+ 0` folds a negative zero away, which would otherwise ride into every
  // equality a receiver makes against it.
  return { x: dx / length + 0, y: -dy / length + 0 };
}

/** The blow a swing lands at its contact beat. */
export function swingStrike(heading: Heading, at: LocalPoint, enchanted: boolean): Strike {
  const direction = headingDirection(heading);
  return {
    at: { x: at.x + direction.x * STRIKE_REACH, y: at.y + direction.y * STRIKE_REACH },
    radius: STRIKE_RADIUS,
    damage: enchanted ? 2 : 1,
    element: enchanted ? "fire" : "steel",
    push: { x: direction.x * STRIKE_PUSH, y: direction.y * STRIKE_PUSH },
  };
}

/** The spell a cast throws at its release beat: a fireball, or a frost nova. */
export function castEvent(heading: Heading, at: LocalPoint, school: "fire" | "frost" = "fire"): CastEvent {
  const direction = headingDirection(heading);
  return {
    from: { x: at.x + direction.x * CAST_REACH, y: at.y + direction.y * CAST_REACH },
    direction,
    heightPx: CAST_HEIGHT_PX,
    element: school,
  };
}
