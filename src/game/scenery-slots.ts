/**
 * Which body gets which slot, on a planet with more trees than slots.
 *
 * Split out of `scenery-layer.ts` for the reason every layer here is thin: the
 * layer is Phaser wiring and cannot be tested without a canvas, while *this* is
 * the part that can be wrong in a way no screenshot shows. A slot that changes
 * tenant when it did not have to resets an integrator, and a chestnut that was
 * mid-sway snaps upright for one frame - visible for 16ms, and impossible to
 * catch by looking.
 *
 * The rule is: a tree keeps the slot it already had, for as long as it fits
 * within the nearest-body budget. Only what is left over is reassigned. `treesNear`
 * returns a *set*, scanned in planet-cell order, and one step sideways changes
 * which cells are scanned - so index-to-index assignment would hand slot 3 to a
 * different tree every step and re-seed a body that never moved.
 */

import { localPlacement, type CameraFrame, type LocalBounds } from "./camera";
import { ROLL_ROWS } from "./horizon";
import { toLocal, type PlanetPoint, type PlanetPose } from "./planet";

/** A tree's identity: where it stands, which no amount of turning changes. */
export interface SlotKeyed {
  readonly x: number;
  readonly y: number;
}

/** What the screen can show, for deciding which bodies are worth a slot. */
export interface SlotView {
  readonly frame: CameraFrame;
  /** The field's tile grid, for the near cut-off behind the hero. */
  readonly bounds: LocalBounds;
  /** Logical pixels across the render target. */
  readonly width: number;
  /** Widest a body can be at full size, so one half off the edge still shows. */
  readonly footprintWidth: number;
}

/**
 * The bodies worth a slot this frame, nearest first.
 *
 * Judged where they would be *drawn* rather than by a box in tiles, because
 * past the field's far edge the two disagree: a tree forty rows out and thirty
 * tiles to the side converges toward the centre of the screen as it shrinks,
 * and a tile box would have thrown it away. So each candidate is placed, and
 * kept if it has not gone over the horizon and lands within a footprint of the
 * edge. A cell of margin behind the hero, for the same reason the grid has one.
 *
 * Nearest first so that when the pool is over-subscribed the trees that lose
 * are the specks on the horizon, never the one about to walk into the hero.
 */
export function bodiesInView<T extends PlanetPoint>(
  candidates: readonly T[],
  pose: PlanetPose,
  view: SlotView,
): T[] {
  const kept: { feature: T; distance: number }[] = [];
  for (const feature of candidates) {
    const local = toLocal(pose, feature);
    if (local.y < view.bounds.minY - 1 || local.y > view.bounds.maxY + 1 + ROLL_ROWS) {
      continue;
    }
    const placed = localPlacement(view.frame, local);
    if (
      placed.visible &&
      placed.x > -view.footprintWidth &&
      placed.x < view.width + view.footprintWidth
    ) {
      kept.push({ feature, distance: local.y });
    }
  }
  return kept.sort((a, b) => a.distance - b.distance).map((entry) => entry.feature);
}

export function keyOf(feature: SlotKeyed): string {
  return `${feature.x},${feature.y}`;
}

/** What a slot is asked to do this frame. */
export interface SlotPlan<T> {
  readonly index: number;
  /** Held over from last frame - keep the instance, and the state inside it. */
  readonly kept?: T;
  /** A new tenant - the slot needs a fresh instance built from its seed. */
  readonly taken?: T;
  /** Nobody wants it - hide it. */
  readonly idle?: true;
}

/**
 * Assign `wanted` across `held.length` slots, preferring incumbents.
 *
 * `held` is the key each slot currently holds, or null for an idle one. The
 * result is one plan per slot, in slot order, so the caller can walk it beside
 * its own array without a second lookup.
 *
 * Over-subscription is truncated rather than thrown: a pool is a budget, and a
 * dense patch of forest should drop the furthest trees rather than the frame.
 * `wanted` is nearest first: limit that set before preserving incumbents, so a
 * distant tenant cannot block a newcomer next to the hero. Surviving incumbents
 * keep their slots and accumulated sway even when their distance order changes.
 */
export function lendSlots<T extends SlotKeyed>(
  held: readonly (string | null)[],
  wanted: readonly T[],
): SlotPlan<T>[] {
  const unclaimed = new Map<string, T>();
  for (const feature of wanted) {
    if (unclaimed.size >= held.length) {
      break;
    }
    unclaimed.set(keyOf(feature), feature);
  }

  const plans: SlotPlan<T>[] = [];
  const free: number[] = [];

  for (let index = 0; index < held.length; index += 1) {
    const key = held[index] ?? null;
    const incumbent = key === null ? undefined : unclaimed.get(key);
    if (key === null || incumbent === undefined) {
      plans.push({ index, idle: true });
      free.push(index);
      continue;
    }
    plans.push({ index, kept: incumbent });
    unclaimed.delete(key);
  }

  // Taken from the front so the slots freed earliest are reused first, which
  // keeps the assignment stable when the same tree leaves and returns.
  let next = 0;
  for (const feature of unclaimed.values()) {
    const index = free[next];
    if (index === undefined) {
      break;
    }
    next += 1;
    plans[index] = { index, taken: feature };
  }

  return plans;
}
