import { describe, expect, it } from "vitest";

import { visibleLocal, type CameraFrame } from "./camera";
import { ROLL_ROWS } from "./horizon";
import { TILE_DEPTH } from "./projection";
import { bodiesInView, keyOf, lendSlots, type SlotView } from "./scenery-slots";

interface Tree {
  readonly x: number;
  readonly y: number;
  readonly seed: number;
}

function tree(x: number, y: number, seed = 0): Tree {
  return { x, y, seed };
}

/** The keys a plan list leaves the slots holding, for feeding back in. */
function nextHeld(plans: ReturnType<typeof lendSlots<Tree>>): (string | null)[] {
  return plans.map((plan) => {
    const feature = plan.kept ?? plan.taken;
    return feature === undefined ? null : keyOf(feature);
  });
}

describe("keyOf", () => {
  it("identifies a tree by where it stands", () => {
    expect(keyOf(tree(3, 4))).toBe("3,4");
  });

  it("separates trees a fraction of a tile apart", () => {
    expect(keyOf(tree(3.25, 4))).not.toBe(keyOf(tree(3.5, 4)));
  });
});

describe("lendSlots", () => {
  it("fills empty slots with everything wanted", () => {
    const plans = lendSlots([null, null, null], [tree(1, 1), tree(2, 2)]);

    expect(plans.filter((plan) => plan.taken !== undefined)).toHaveLength(2);
    expect(plans.filter((plan) => plan.idle === true)).toHaveLength(1);
  });

  it("keeps an incumbent in the slot it already held", () => {
    const first = lendSlots([null, null], [tree(1, 1), tree(2, 2)]);
    const again = lendSlots(nextHeld(first), [tree(1, 1), tree(2, 2)]);

    expect(again.every((plan) => plan.kept !== undefined)).toBe(true);
    expect(nextHeld(again)).toEqual(nextHeld(first));
  });

  // The whole reason this module exists: `treesNear` scans in planet-cell
  // order, so one step re-orders the same set. Assigning by index would move
  // every body to a different slot and reset the sway inside it.
  it("keeps incumbents when the wanted list is re-ordered", () => {
    const first = lendSlots([null, null, null], [tree(1, 1), tree(2, 2), tree(3, 3)]);
    const again = lendSlots(nextHeld(first), [tree(3, 3), tree(1, 1), tree(2, 2)]);

    expect(again.some((plan) => plan.taken !== undefined)).toBe(false);
    expect(nextHeld(again)).toEqual(nextHeld(first));
  });

  it("hands a departed tree's slot to a newcomer", () => {
    const first = lendSlots([null, null], [tree(1, 1), tree(2, 2)]);
    const again = lendSlots(nextHeld(first), [tree(1, 1), tree(9, 9)]);

    const kept = again.filter((plan) => plan.kept !== undefined);
    const taken = again.filter((plan) => plan.taken !== undefined);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.kept).toEqual(tree(1, 1));
    expect(taken).toHaveLength(1);
    expect(taken[0]?.taken).toEqual(tree(9, 9));
    // And it reuses the freed slot rather than growing the pool.
    expect(again).toHaveLength(2);
  });

  it("idles a slot whose tree left with nothing to replace it", () => {
    const first = lendSlots([null, null], [tree(1, 1), tree(2, 2)]);
    const again = lendSlots(nextHeld(first), [tree(1, 1)]);

    expect(again.filter((plan) => plan.idle === true)).toHaveLength(1);
    expect(nextHeld(again)).toContain(null);
  });

  it("truncates to the pool rather than overflowing it", () => {
    const wanted = Array.from({ length: 5 }, (_unused, index) => tree(index, 0));
    const plans = lendSlots([null, null], wanted);

    expect(plans).toHaveLength(2);
    expect(plans.every((plan) => plan.taken !== undefined)).toBe(true);
  });

  it("lets incumbents win when the pool is over-subscribed", () => {
    const first = lendSlots([null, null], [tree(1, 1), tree(2, 2)]);
    const crowded = [tree(1, 1), tree(2, 2), tree(3, 3), tree(4, 4)];
    const again = lendSlots(nextHeld(first), crowded);

    expect(again.every((plan) => plan.kept !== undefined)).toBe(true);
  });

  it("returns one plan per slot, in slot order", () => {
    const plans = lendSlots([null, null, null, null], [tree(1, 1)]);

    expect(plans.map((plan) => plan.index)).toEqual([0, 1, 2, 3]);
  });

  it("idles every slot when nothing is in reach", () => {
    const first = lendSlots([null, null], [tree(1, 1), tree(2, 2)]);
    const again = lendSlots(nextHeld(first), []);

    expect(again.every((plan) => plan.idle === true)).toBe(true);
  });

  it("copes with an empty pool", () => {
    expect(lendSlots([], [tree(1, 1)])).toEqual([]);
  });

  it("is stable across a long walk that swaps the whole set", () => {
    let held: (string | null)[] = [null, null, null];
    // Each step drops the furthest tree and gains one, which is what walking
    // forward actually does to `treesNear`.
    for (let step = 0; step < 6; step += 1) {
      const wanted = [tree(step, 0), tree(step + 1, 0), tree(step + 2, 0)];
      const plans = lendSlots(held, wanted);
      // Exactly one newcomer per step once the pool has filled.
      if (step > 0) {
        expect(plans.filter((plan) => plan.taken !== undefined)).toHaveLength(1);
      }
      held = nextHeld(plans);
    }
    expect(held.filter((key) => key !== null)).toHaveLength(3);
  });
});

describe("bodiesInView", () => {
  const frame: CameraFrame = {
    groundTop: 9,
    rollHeight: 3,
    footX: 160,
    footY: 100,
    phaseX: 0,
    phaseY: 0,
  };
  const bounds = visibleLocal(frame, 320, 180);
  const view: SlotView = { frame, bounds, width: 320, footprintWidth: 74 };
  /** Facing planet north, so local (x, y) is planet (128 + x, 128 + y). */
  const pose = { x: 128, y: 128, turn: 0 };
  const at = (x: number, y: number): Tree => tree(128 + x, 128 + y);
  const farEdge = (frame.footY - frame.groundTop) / TILE_DEPTH;

  it("keeps what stands in the field", () => {
    expect(bodiesInView([at(0, 3), at(-4, -2)], pose, view)).toHaveLength(2);
  });

  it("keeps a body on the roll all the way out to the horizon, and drops one past it", () => {
    const onRoll = at(0, farEdge + ROLL_ROWS - 1);
    const gone = at(0, farEdge + ROLL_ROWS + 2);
    expect(bodiesInView([onRoll, gone], pose, view)).toEqual([onRoll]);
  });

  it("judges the edge where a body is drawn, not by a box in tiles", () => {
    // Thirty tiles to the side is far outside the field's grid but, forty rows
    // out, converges to well inside the screen.
    const wide = at(30, farEdge + 40);
    const wideAndNear = at(30, 2);
    expect(bodiesInView([wide, wideAndNear], pose, view)).toEqual([wide]);
  });

  it("drops what is behind the hero, with a cell of margin", () => {
    const justBehind = at(0, bounds.minY - 0.5);
    const wellBehind = at(0, bounds.minY - 3);
    expect(bodiesInView([justBehind, wellBehind], pose, view)).toEqual([justBehind]);
  });

  it("puts the nearest first, so an over-subscribed pool drops the specks", () => {
    const near = at(1, 1);
    const mid = at(1, farEdge + 5);
    const far = at(1, farEdge + 30);
    expect(bodiesInView([far, near, mid], pose, view)).toEqual([near, mid, far]);
  });
});
