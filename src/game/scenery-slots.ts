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
 * The rule is: a tree keeps the slot it already had, for as long as it is in
 * reach. Only what is left over is reassigned. That matters because `treesNear`
 * returns a *set*, scanned in planet-cell order, and one step sideways changes
 * which cells are scanned - so index-to-index assignment would hand slot 3 to a
 * different tree every step and re-seed a body that never moved.
 */

/** A tree's identity: where it stands, which no amount of turning changes. */
export interface SlotKeyed {
  readonly x: number;
  readonly y: number;
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
 * dense patch of forest should drop the trees that did not fit rather than the
 * frame. Incumbents win those ties, which is also what stops the pool flickering
 * between two over-large sets on alternate frames.
 */
export function lendSlots<T extends SlotKeyed>(
  held: readonly (string | null)[],
  wanted: readonly T[],
): SlotPlan<T>[] {
  const unclaimed = new Map<string, T>();
  for (const feature of wanted) {
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
