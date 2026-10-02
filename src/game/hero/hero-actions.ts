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
import type { LocalPoint } from "../planet";
import type { Facing } from "../player";

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
 * A facing as a unit vector in the local frame.
 *
 * A yaw of 0 faces the viewer, which is *down* the screen, and the local
 * frame's `y` is *ahead*, which is up it — so `y` is `-cos`. Always unit length,
 * so a blow at any angle reaches exactly as far as one straight ahead.
 */
export function facingDirection(facing: Facing): { readonly x: number; readonly y: number } {
  // `+ 0` folds a negative zero away, which would otherwise ride into every
  // equality a receiver makes against it.
  return { x: Math.sin(facing) + 0, y: -Math.cos(facing) + 0 };
}

/** The blow a swing lands at its contact beat. */
export function swingStrike(facing: Facing, at: LocalPoint, enchanted: boolean): Strike {
  const direction = facingDirection(facing);
  return {
    at: { x: at.x + direction.x * STRIKE_REACH, y: at.y + direction.y * STRIKE_REACH },
    radius: STRIKE_RADIUS,
    damage: enchanted ? 2 : 1,
    element: enchanted ? "fire" : "steel",
    push: { x: direction.x * STRIKE_PUSH, y: direction.y * STRIKE_PUSH },
  };
}

/** The spell a cast throws at its release beat: a fireball, or a frost nova. */
export function castEvent(facing: Facing, at: LocalPoint, school: "fire" | "frost" = "fire"): CastEvent {
  const direction = facingDirection(facing);
  return {
    from: { x: at.x + direction.x * CAST_REACH, y: at.y + direction.y * CAST_REACH },
    direction,
    heightPx: CAST_HEIGHT_PX,
    element: school,
  };
}
