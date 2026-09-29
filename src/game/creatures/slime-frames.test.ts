import { describe, expect, it } from "vitest";

import { validateRegistry } from "../registry-validation";
import { CREATURE_ASSETS } from "../registry/creatures";
import { emergeFrames, familySwap, hopFrames, idleFrames, SLIME_LAB_FRAME, strikeFrames } from "./slime-frames";

describe("slime lab strips", () => {
  it("are all one frame size", () => {
    for (const frames of [idleFrames("green", 3, 100), hopFrames("fire", 64), strikeFrames("green", false, 64, 256), emergeFrames("arcane", 3, 200)]) {
      for (const frame of frames) {
        expect(frame.rows).toHaveLength(SLIME_LAB_FRAME.height);
        expect(frame.rows[0]).toHaveLength(SLIME_LAB_FRAME.width);
      }
    }
  });

  it("reproduce byte for byte", () => {
    expect(hopFrames("green", 64)).toEqual(hopFrames("green", 64));
    expect(strikeFrames("green", true, 128, 900)).toEqual(strikeFrames("green", true, 128, 900));
  });

  it("show the slime moving during a hop", () => {
    const frames = hopFrames("green", 32);
    expect(new Set(frames.map((frame) => frame.rows.join("\n"))).size).toBeGreaterThan(10);
  });

  it("swap a family only through tokens every frame carries", () => {
    const frames = idleFrames("green", 4, 300);
    const swap = familySwap(frames, "slime", "arcane", "arcane");
    expect(Object.keys(swap.overrides).length).toBeGreaterThan(0);
    for (const token of Object.keys(swap.overrides)) {
      expect(frames.every((frame) => token in frame.palette)).toBe(true);
    }
  });

  it("make a registry that validates", () => {
    expect(CREATURE_ASSETS.length).toBeGreaterThanOrEqual(8);
    expect(validateRegistry(CREATURE_ASSETS)).toEqual([]);
  });
});
