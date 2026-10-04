import { describe, expect, it } from "vitest";

import { localPlacement, type CameraFrame } from "../../game/camera";
import { DEFAULT_SKY_FRACTION, ROLL_ROWS } from "../../game/horizon";
import { TILE_WIDTH } from "../../game/projection";
import { lowpolyView, placeVertex } from "./placement";

const view = lowpolyView(16 / 9, DEFAULT_SKY_FRACTION, 20);

/** The pixel skin's frame for the same layout, mid-stride at zero phase: the skin draws from the live pose. */
const frame: CameraFrame = {
  groundTop: view.layout.groundTop,
  rollHeight: view.layout.rollHeight,
  footX: view.footX,
  footY: view.footY,
  phaseX: 0,
  phaseY: 0,
};

describe("the low-poly projection", () => {
  it("puts every foot where the pixel skin does - on the field, on the lip and past the horizon", () => {
    for (const y of [-6, 0, 3, 6.5, 9, 20, 40, 55, 70]) {
      for (const x of [-9, 0, 4.5]) {
        const placed = placeVertex(view, { x, y }, { x: 0, y: 0, z: 0 });
        const pixel = localPlacement(frame, { x, y });
        // The pixel skin rounds to whole pixels; this skin does not.
        expect(Math.abs(placed.x - pixel.x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(placed.y - pixel.y)).toBeLessThanOrEqual(0.5);
        expect(placed.scale).toBeCloseTo(pixel.scale, 9);
      }
    }
  });

  it("is affine on the field: a tile across is a tile across at every depth", () => {
    const near = placeVertex(view, { x: 0, y: 0 }, { x: 1, y: 0, z: 0 });
    const far = placeVertex(view, { x: 0, y: 5 }, { x: 1, y: 0, z: 0 });
    expect(near.x - view.footX).toBe(TILE_WIDTH);
    expect(far.x - view.footX).toBe(TILE_WIDTH);
    expect(near.scale).toBe(1);
  });

  it("shrinks a body about its foot on the lip, and stands a height up the screen", () => {
    const foot = { x: 2, y: 30 };
    const base = placeVertex(view, foot, { x: 0, y: 0, z: 0 });
    const top = placeVertex(view, foot, { x: 0, y: 0, z: 2 });
    expect(base.rowsBeyond).toBeGreaterThan(0);
    expect(base.scale).toBeLessThan(1);
    expect(base.y - top.y).toBeCloseTo(2 * 16 * base.scale, 9);
  });

  it("sinks what is past the horizon below the line, so only its top shows", () => {
    const rows = ROLL_ROWS + 20;
    const foot = { x: 0, y: (view.footY - view.layout.groundTop) / 12 + rows };
    const placed = placeVertex(view, foot, { x: 0, y: 0, z: 0 });
    expect(placed.y).toBeGreaterThan(view.layout.horizonY);
  });

  it("keeps depth in rows ahead, so a nearer row always wins the z-buffer", () => {
    let last = -Infinity;
    for (let y = -5; y < 90; y += 0.5) {
      const depth = placeVertex(view, { x: 0, y }, { x: 0, y: 0, z: 0 }).depth;
      expect(depth).toBeGreaterThan(last);
      last = depth;
    }
  });

  it("takes its width from the window and keeps its height", () => {
    expect(lowpolyView(1, DEFAULT_SKY_FRACTION, 20).width).toBe(180);
    expect(lowpolyView(21 / 9, DEFAULT_SKY_FRACTION, 20).height).toBe(180);
    expect(lowpolyView(Number.NaN, DEFAULT_SKY_FRACTION, 20).width).toBe(320);
  });
});
