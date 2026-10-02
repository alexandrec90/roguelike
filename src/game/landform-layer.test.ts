import { describe, expect, it } from "vitest";

import { scrollOffset, type CameraFrame } from "./camera";
import { wholePixelFrame } from "./landform-layer";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";

const FRAME: CameraFrame = { groundTop: 40, rollHeight: 24, footX: 160, footY: 113, phaseX: 0, phaseY: 0 };

describe("wholePixelFrame", () => {
  it("rounds a stride in flight to the whole pixels the ground is scrolled by", () => {
    // A landform's foot drawn from a finer phase than the tiles under it would
    // shear against them by a pixel, back and forth, every stride.
    for (const [phaseX, phaseY] of [
      [0.13, 0.41],
      [-0.52, 0.97],
      [0, 0],
    ] as const) {
      const frame = { ...FRAME, phaseX, phaseY };
      const whole = wholePixelFrame(frame);
      expect(scrollOffset(whole)).toEqual(scrollOffset(frame));
      expect(Number.isInteger(whole.phaseX * TILE_WIDTH)).toBe(true);
      expect(Number.isInteger(Math.round(whole.phaseY * TILE_DEPTH * 1e9) / 1e9)).toBe(true);
    }
  });
});
