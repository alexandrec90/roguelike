import { describe, expect, it } from "vitest";

import {
  localFoot,
  localOrigin,
  localRow,
  localReach,
  scrollOffset,
  visibleLocal,
  type CameraFrame,
} from "./camera";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";

const FRAME: CameraFrame = { groundTop: 9, footX: 160, footY: 100, phaseX: 0, phaseY: 0 };

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
