import { describe, expect, it } from "vitest";

import { localFoot, scrollOffset, type CameraFrame } from "../camera";
import { groundFoot, onField } from "./anchor";

const FRAME: CameraFrame = { groundTop: 22, rollHeight: 8, footX: 160, footY: 120, phaseX: 0, phaseY: 0 };

describe("groundFoot", () => {
  it("is localFoot when no step is in flight", () => {
    expect(groundFoot(FRAME, { x: 2.3, y: 1.7 })).toEqual(localFoot(FRAME, { x: 2.3, y: 1.7 }));
  });

  it("is the zero-phase foot plus the scroll mid-step, the way the ground is drawn", () => {
    const moving = { ...FRAME, phaseX: 0.37, phaseY: 0.61 };
    const flat = localFoot(FRAME, { x: 2.3, y: 1.7 });
    const offset = scrollOffset(moving);
    expect(groundFoot(moving, { x: 2.3, y: 1.7 })).toEqual({ x: flat.x + offset.x, y: flat.y + offset.y });
  });
});

describe("onField", () => {
  it("is false over the horizon roll and far off screen", () => {
    expect(onField(FRAME, { x: 100, y: 100 }, 320, 180, 16)).toBe(true);
    expect(onField(FRAME, { x: 100, y: 10 }, 320, 180, 16)).toBe(false);
    expect(onField(FRAME, { x: -40, y: 100 }, 320, 180, 16)).toBe(false);
    expect(onField(FRAME, { x: 100, y: 400 }, 320, 180, 16)).toBe(false);
  });
});
