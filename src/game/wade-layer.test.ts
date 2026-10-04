import { describe, expect, it } from "vitest";

import type { CameraFrame } from "./camera";
import type { FrameContext } from "./frame-context";
import type { PixelCloud } from "./ink";
import { planetLakes, type Lake } from "./lakes";
import { MAX_SINK, sinkRows, WadeLayer, type RingWater } from "./wade-layer";
import type { Foot } from "./water-layer";
import { aboveWater, STEP_RING, waterlineReflection } from "./water/wake";

const LAKE = planetLakes().find((lake) => lake.deep > 0) as Lake;

const FRAME: CameraFrame = { groundTop: 40, rollHeight: 24, footX: 160, footY: 120, phaseX: 0, phaseY: 0 };

/** Water everywhere, or nowhere, that records every ring it is asked for. */
function water(wet: boolean): RingWater & { readonly rings: { foot: Foot; radius: number }[] } {
  const rings: { foot: Foot; radius: number }[] = [];
  return {
    rings,
    holdsWater: () => wet,
    ring: (foot, _frame, _life, radius) => {
      rings.push({ foot, radius });
      return wet;
    },
  };
}

function context(deltaMs: number): FrameContext {
  return { frame: FRAME, deltaMs } as FrameContext;
}

describe("sinkRows", () => {
  it("sinks nothing on dry ground, or in a puddle away from any lake", () => {
    expect(sinkRows(false, LAKE)).toBe(0);
    expect(sinkRows(true, { x: LAKE.x + LAKE.reach + 3, y: LAKE.y })).toBe(0);
  });

  it("sinks from the ankles at the shore to the shins at the deep water", () => {
    expect(sinkRows(true, { x: LAKE.x + LAKE.shore, y: LAKE.y })).toBe(1);
    expect(sinkRows(true, { x: LAKE.x + LAKE.deep, y: LAKE.y })).toBe(MAX_SINK);
  });
});

describe("aboveWater and waterlineReflection", () => {
  const legs: PixelCloud = [0, -1, -2, -3, -4].map((y) => ({ x: 0, y, ink: "bone" }));

  it("hides the rows under the water and keeps the rest", () => {
    expect(aboveWater(legs, 0)).toBe(legs);
    expect(aboveWater(legs, 2).map((pixel) => pixel.y)).toEqual([-2, -3, -4]);
  });

  it("mirrors about the waterline, not about the hidden feet", () => {
    const foot = { x: 50, y: 80 };
    expect(waterlineReflection(legs, foot, 0)).toEqual({ cloud: legs, foot });
    const sunk = waterlineReflection(aboveWater(legs, 2), foot, 2);
    expect(sunk.foot).toEqual({ x: 50, y: 78 });
    // The lowest visible row sits on the waterline, so the reflection starts right under it.
    expect(Math.max(...sunk.cloud.map((pixel) => pixel.y))).toBe(0);
    // Every pixel stays where it was drawn on screen.
    expect(sunk.cloud.map((pixel) => pixel.y + sunk.foot.y)).toEqual([78, 77, 76]);
  });
});

describe("WadeLayer", () => {
  it("rings the water at each footfall, a step's ring wider than a drop's", () => {
    const layer = new WadeLayer(7);
    const wet = water(true);
    for (let frame = 0; frame <= 30; frame += 1) {
      layer.update(context(16), wet, [{ id: "hero", foot: { x: 160, y: 120 }, travelled: frame / 10 + 0.05 }]);
    }
    // Stepping in at 0, then a footfall at each of 1, 2 and 3 tiles.
    expect(wet.rings.length).toBe(4);
    expect(wet.rings.every((ring) => ring.radius === STEP_RING.radius)).toBe(true);
    // The feet strike either side of the wader's centre.
    expect(new Set(wet.rings.map((ring) => ring.foot.x)).size).toBe(2);
  });

  it("leaves dry ground alone", () => {
    const layer = new WadeLayer(7);
    const dry = water(false);
    for (let frame = 0; frame <= 30; frame += 1) {
      layer.update(context(16), dry, [{ id: "hero", foot: { x: 160, y: 120 }, travelled: frame / 10 }]);
    }
    expect(dry.rings).toEqual([]);
  });

  it("forgets a wader that is no longer listed, so it splashes afresh on return", () => {
    const layer = new WadeLayer(7);
    const wet = water(true);
    layer.update(context(16), wet, [{ id: "slime", foot: { x: 10, y: 10 }, travelled: 0.5 }]);
    layer.update(context(16), wet, []);
    layer.update(context(16), wet, [{ id: "slime", foot: { x: 10, y: 10 }, travelled: 0.5 }]);
    expect(wet.rings).toHaveLength(2);
  });
});
