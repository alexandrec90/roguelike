import { describe, expect, it } from "vitest";

import {
  groundRow,
  latticeRow,
  localFoot,
  localOrigin,
  localPlacement,
  localRow,
  localReach,
  projectDepth,
  rollPoint,
  scrollOffset,
  scrollRows,
  visibleLocal,
  type CameraFrame,
} from "./camera";
import { HORIZON_SCALE, ROLL_ROWS } from "./horizon";
import { RANK, rootedDepth, standingDepth, TILE_DEPTH, TILE_WIDTH } from "./projection";

const FRAME: CameraFrame = {
  groundTop: 9,
  rollHeight: 3,
  footX: 160,
  footY: 100,
  phaseX: 0,
  phaseY: 0,
};

/** Local rows ahead at which the affine foot lands exactly on `groundTop`. */
const FAR_EDGE = (FRAME.footY - FRAME.groundTop) / TILE_DEPTH;

describe("rollPoint", () => {
  it("leaves a pixel on the flat field exactly where it was laid out", () => {
    expect(rollPoint(FRAME, 120, 60, 7)).toEqual({ x: 120, y: 53, scale: 1 });
    expect(rollPoint(FRAME, 200, FRAME.groundTop, 0)).toEqual({ x: 200, y: FRAME.groundTop, scale: 1 });
  });

  it("carries a pixel past the far edge onto the roll, as localPlacement carries a body", () => {
    for (const rows of [0.5, 2, 9, 30]) {
      const local = { x: 3, y: FAR_EDGE + rows };
      const flat = localFoot(FRAME, local);
      const body = localPlacement(FRAME, local);
      const placed = rollPoint(FRAME, flat.x, flat.y, 0);
      expect(placed).toMatchObject({ x: body.x, y: body.y });
      expect(placed?.scale).toBeCloseTo(body.scale, 12);
    }
  });

  it("shrinks a height above the ground with the roll's scale", () => {
    const flatGround = FRAME.groundTop - 4 * TILE_DEPTH;
    const foot = rollPoint(FRAME, FRAME.footX, flatGround, 0);
    const raised = rollPoint(FRAME, FRAME.footX, flatGround, 20);
    expect(foot).not.toBeNull();
    expect(raised).not.toBeNull();
    expect(foot!.scale).toBeLessThan(1);
    expect(raised!.scale).toBe(foot!.scale);
    expect(Math.abs(foot!.y - raised!.y - 20 * foot!.scale)).toBeLessThanOrEqual(1);
  });

  it("is never drawn below where the flat field would have put it, nor below the seam", () => {
    for (let ground = FRAME.groundTop - 1; ground > FRAME.groundTop - 60; ground -= 3) {
      const placed = rollPoint(FRAME, 140, ground, 7);
      expect(placed).not.toBeNull();
      expect(placed!.y).toBeGreaterThanOrEqual(ground - 7);
      expect(placed!.y).toBeLessThanOrEqual(FRAME.groundTop);
    }
  });

  it("hides a pixel that has sunk behind the horizon line", () => {
    const past = FRAME.groundTop - (ROLL_ROWS + 30) * TILE_DEPTH;
    expect(rollPoint(FRAME, FRAME.footX, past, 0)).toBeNull();
  });
});

describe("localPlacement", () => {
  it("is localFoot at full size anywhere in the flat field", () => {
    for (const local of [
      { x: 0, y: 0 },
      { x: -3, y: 2 },
      { x: 5, y: -4 },
      { x: 2, y: FAR_EDGE },
    ]) {
      expect(localPlacement(FRAME, local)).toEqual({
        ...localFoot(FRAME, local),
        scale: 1,
        visible: true,
        clipY: Number.POSITIVE_INFINITY,
      });
    }
  });

  it("meets the field exactly at its far edge, so a body walking on never pops", () => {
    const seam = localPlacement(FRAME, { x: 4, y: FAR_EDGE });
    const justPast = localPlacement(FRAME, { x: 4, y: FAR_EDGE + 0.001 });

    expect(seam.y).toBe(FRAME.groundTop);
    expect(justPast.y).toBe(FRAME.groundTop);
    expect(justPast.x).toBe(seam.x);
    expect(justPast.scale).toBeCloseTo(1, 2);
  });

  it("lifts a body up the roll and shrinks it as it recedes", () => {
    const near = localPlacement(FRAME, { x: 6, y: FAR_EDGE + 4 });
    const far = localPlacement(FRAME, { x: 6, y: FAR_EDGE + 30 });

    expect(near.y).toBeLessThan(FRAME.groundTop);
    expect(far.y).toBeLessThanOrEqual(near.y);
    expect(far.y).toBeGreaterThanOrEqual(FRAME.groundTop - FRAME.rollHeight);
    expect(far.scale).toBeLessThan(near.scale);
    expect(near.scale).toBeLessThan(1);
  });

  it("converges a far body toward the hero's own column", () => {
    const near = localPlacement(FRAME, { x: 8, y: FAR_EDGE + 1 });
    const far = localPlacement(FRAME, { x: 8, y: FAR_EDGE + 40 });

    expect(far.x - FRAME.footX).toBeLessThan(near.x - FRAME.footX);
    expect(far.x).toBeGreaterThan(FRAME.footX);
  });

  it("stands a body on the horizon line at HORIZON_SCALE, and sinks it behind the curve past there", () => {
    // The regression: a body past the line used to vanish whole - a tree
    // blinked out at the horizon, and a mountain could never be seen far off.
    const horizonY = FRAME.groundTop - FRAME.rollHeight;
    const onLine = localPlacement(FRAME, { x: 0, y: FAR_EDGE + ROLL_ROWS });
    const past = localPlacement(FRAME, { x: 0, y: FAR_EDGE + ROLL_ROWS + 10 });
    const farther = localPlacement(FRAME, { x: 0, y: FAR_EDGE + ROLL_ROWS + 20 });

    expect(onLine.y).toBe(horizonY);
    expect(onLine.scale).toBeCloseTo(HORIZON_SCALE, 12);
    expect(onLine.clipY).toBe(Number.POSITIVE_INFINITY);
    expect(past.visible).toBe(true);
    expect(past.clipY).toBe(horizonY);
    expect(past.y).toBeGreaterThan(horizonY);
    expect(farther.y).toBeGreaterThan(past.y);
    expect(past.scale).toBeLessThan(HORIZON_SCALE);
    expect(farther.scale).toBeLessThan(past.scale);
  });

  it("gives up on a body once nothing on the planet could stand tall enough to show", () => {
    expect(localPlacement(FRAME, { x: 0, y: FAR_EDGE + ROLL_ROWS + 200 }).visible).toBe(false);
  });

  it("reads the stride like the field does, so the roll scrolls with the ground", () => {
    // Half a step forward carries a far body the same way it carries the grid.
    const still = localPlacement(FRAME, { x: 0, y: FAR_EDGE + 2 });
    const walking = localPlacement({ ...FRAME, phaseY: 0.5 }, { x: 0, y: FAR_EDGE + 2 });

    expect(walking.scale).toBeGreaterThan(still.scale);
    expect(walking.y).toBeGreaterThanOrEqual(still.y);
  });

  it("always lands on a whole pixel", () => {
    for (const phase of [0.1, 0.37, 0.5, 0.83]) {
      const placed = localPlacement({ ...FRAME, phaseX: phase, phaseY: phase }, { x: 3, y: FAR_EDGE + 7 });
      expect(Number.isInteger(placed.x)).toBe(true);
      expect(Number.isInteger(placed.y)).toBe(true);
    }
  });
});

describe("localFoot", () => {
  it("puts the hero on his own anchor", () => {
    expect(localFoot(FRAME, { x: 0, y: 0 })).toEqual({ x: 160, y: 100 });
  });

  it("sends +y up the screen and +x right, by a whole tile each", () => {
    expect(localFoot(FRAME, { x: 1, y: 0 })).toEqual({ x: 160 + TILE_WIDTH, y: 100 });
    expect(localFoot(FRAME, { x: 0, y: 1 })).toEqual({ x: 160, y: 100 - TILE_DEPTH });
    expect(localFoot(FRAME, { x: 0, y: -1 })).toEqual({ x: 160, y: 100 + TILE_DEPTH });
  });

  it("slides the world the other way from the walk", () => {
    // Walking forward has to bring the ground *toward* the camera, and walking
    // right has to take it left; a sign error here is a world that runs away.
    const forward = localFoot({ ...FRAME, phaseY: 0.5 }, { x: 0, y: 0 });
    const right = localFoot({ ...FRAME, phaseX: 0.5 }, { x: 0, y: 0 });

    expect(forward.y).toBeGreaterThan(100);
    expect(right.x).toBeLessThan(160);
  });

  it("lands exactly one tile on from a whole step, which is what cancels the scroll", () => {
    // The scroll and the sample must meet: a full phase draws the grid exactly
    // where the next sample will put the content, so the step boundary is
    // invisible. If these ever disagree the world pops once per stride.
    expect(localFoot({ ...FRAME, phaseY: 1 }, { x: 0, y: 1 })).toEqual(
      localFoot(FRAME, { x: 0, y: 0 }),
    );
    expect(localFoot({ ...FRAME, phaseX: 1 }, { x: 1, y: 0 })).toEqual(
      localFoot(FRAME, { x: 0, y: 0 }),
    );
  });

  it("always lands on a whole pixel", () => {
    for (const phase of [0.1, 0.37, 0.5, 0.83]) {
      const foot = localFoot({ ...FRAME, phaseX: phase, phaseY: phase }, { x: 3, y: -2 });
      expect(Number.isInteger(foot.x)).toBe(true);
      expect(Number.isInteger(foot.y)).toBe(true);
    }
  });
});

describe("localOrigin", () => {
  it("is the foot pulled back to the tile's top-left corner", () => {
    const foot = localFoot(FRAME, { x: 2, y: 1 });
    expect(localOrigin(FRAME, { x: 2, y: 1 })).toEqual({
      x: foot.x - TILE_WIDTH / 2,
      y: foot.y - TILE_DEPTH,
    });
  });
});

describe("localRow", () => {
  it("is the hero's own row at the origin, and counts up toward the camera", () => {
    const here = localRow(FRAME, { x: 0, y: 0 });
    expect(localRow(FRAME, { x: 0, y: 1 })).toBeCloseTo(here - 1, 9);
    expect(localRow(FRAME, { x: 0, y: -1 })).toBeCloseTo(here + 1, 9);
  });

  it("stays fractional between rows, so a scrolling thing sorts as it moves", () => {
    const half = localRow({ ...FRAME, phaseY: 0.5 }, { x: 0, y: 0 });
    expect(Number.isInteger(half)).toBe(false);
  });
});

describe("groundRow", () => {
  /** A row of tufts, as the vegetation layer sorts it. */
  const grassDepth = (frame: CameraFrame, y: number): number =>
    rootedDepth(latticeRow(frame, { x: 0, y }), RANK.grass) + scrollRows(frame) * TILE_WIDTH;

  it("keeps a body and the grass beside it in one order through a whole stride", () => {
    // The bug this pins: a boulder's row was rounded after the scroll and the
    // grass's before it, so the tufts at its foot blinked over and under it
    // twice a tile as the hero walked.
    for (const bodyY of [2.3, 2.5, 2.7, 3.05, 3.45]) {
      for (const cellY of [1, 2, 3, 4]) {
        const orders = new Set<boolean>();
        for (let phase = -0.99; phase < 1; phase += 0.01) {
          const frame = { ...FRAME, phaseY: phase };
          orders.add(standingDepth(groundRow(frame, { x: 0, y: bodyY }), RANK.body) > grassDepth(frame, cellY));
        }
        expect(orders.size, `body ${bodyY}, grass row ${cellY}`).toBe(1);
      }
    }
  });

  it("slides by the same whole-pixel scroll the ground is drawn with", () => {
    for (const phase of [-0.7, -0.31, 0.04, 0.5, 0.96]) {
      const frame = { ...FRAME, phaseY: phase };
      const at = groundRow(frame, { x: 0, y: 2.4 });
      expect(at - latticeRow(frame, { x: 0, y: 2.4 })).toBeCloseTo(scrollOffset(frame).y / TILE_DEPTH, 9);
    }
  });

  it("rounds on the zero-phase grid, so a slid row is a lattice row plus the slide", () => {
    expect(Number.isInteger(latticeRow({ ...FRAME, phaseY: 0.43 }, { x: 0, y: 1.2 }))).toBe(true);
    expect(latticeRow({ ...FRAME, phaseY: 0.43 }, { x: 0, y: 1.2 })).toBe(latticeRow(FRAME, { x: 0, y: 1.2 }));
  });
});

describe("projectDepth", () => {
  it("is the affine field this side of the seam", () => {
    const depth = projectDepth(FRAME, 2);
    expect(depth.ground).toBe(FRAME.footY - 2 * TILE_DEPTH);
    expect(depth.scale).toBe(1);
    expect(depth.rowsBeyond).toBe(0);
    expect(depth.sink).toBe(0);
  });

  it("is continuous from the field over the roll and past the horizon line", () => {
    // The game's own roll: a tiny one is legitimately steep, not discontinuous.
    const game = { ...FRAME, groundTop: 40, rollHeight: 24 };
    const edge = (game.footY - game.groundTop) / TILE_DEPTH;
    let last = projectDepth(game, 0);
    for (let y = 0.05; y < edge + ROLL_ROWS + 40; y += 0.05) {
      const depth = projectDepth(game, y);
      expect(depth.scale).toBeLessThanOrEqual(last.scale + 1e-9);
      expect(Math.abs(depth.scale - last.scale)).toBeLessThan(0.02);
      expect(Math.abs(depth.ground - last.ground)).toBeLessThan(1);
      last = depth;
    }
    const onLine = projectDepth(game, edge + ROLL_ROWS);
    const justOver = projectDepth(game, edge + ROLL_ROWS + 0.01);
    expect(justOver.scale).toBeCloseTo(onLine.scale, 3);
    expect(justOver.ground).toBeCloseTo(onLine.ground, 3);
  });

  it("agrees with localPlacement wherever a body stands", () => {
    for (const y of [1, FAR_EDGE + 3, FAR_EDGE + ROLL_ROWS + 6]) {
      const depth = projectDepth(FRAME, y);
      const placed = localPlacement(FRAME, { x: 0, y });
      expect(placed.y).toBe(Math.round(depth.ground));
      expect(placed.scale).toBe(depth.scale);
      expect(placed.clipY).toBe(depth.clipY);
    }
  });
});

describe("scrollOffset", () => {
  it("is zero at rest and a whole tile at the end of a stride", () => {
    expect(scrollOffset(FRAME)).toEqual({ x: 0, y: 0 });
    expect(scrollOffset({ ...FRAME, phaseX: 1 })).toEqual({ x: -TILE_WIDTH, y: 0 });
    expect(scrollOffset({ ...FRAME, phaseY: 1 })).toEqual({ x: 0, y: TILE_DEPTH });
  });

  it("is whole pixels, so nothing can shear against its neighbour", () => {
    const offset = scrollOffset({ ...FRAME, phaseX: 0.31, phaseY: 0.77 });
    expect(Number.isInteger(offset.x)).toBe(true);
    expect(Number.isInteger(offset.y)).toBe(true);
  });
});

describe("visibleLocal", () => {
  it("covers the whole render target with a cell of margin", () => {
    const bounds = visibleLocal(FRAME, 320, 180);

    // Left edge and right edge both reachable, and then some.
    expect(localFoot(FRAME, { x: bounds.minX, y: 0 }).x).toBeLessThan(0);
    expect(localFoot(FRAME, { x: bounds.maxX, y: 0 }).x).toBeGreaterThan(320);
    // Far edge above the horizon foot, near edge below the bottom scanline.
    expect(localFoot(FRAME, { x: 0, y: bounds.maxY }).y).toBeLessThan(FRAME.groundTop);
    expect(localFoot(FRAME, { x: 0, y: bounds.minY }).y).toBeGreaterThan(180);
  });

  it("grows the grid when the hero is pinned low in a tall band", () => {
    const low = visibleLocal({ ...FRAME, footY: 170 }, 320, 180);
    const high = visibleLocal({ ...FRAME, footY: 30 }, 320, 180);
    expect(low.maxY).toBeGreaterThan(high.maxY);
  });
});

describe("localReach", () => {
  it("is a radius that contains every corner of the grid", () => {
    const bounds = visibleLocal(FRAME, 320, 180);
    const reach = localReach(bounds);

    for (const corner of [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
      { x: bounds.maxX, y: bounds.minY },
    ]) {
      expect(Math.hypot(corner.x, corner.y)).toBeLessThanOrEqual(reach);
    }
  });
});
