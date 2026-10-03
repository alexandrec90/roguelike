import { describe, expect, it } from "vitest";

import { feedMap } from "./demo-scene";
import { HeroLayer } from "./hero-layer";
import type { MapOverlay } from "./map-overlay";

describe("feedMap", () => {
  it("hands the map the frame the layers drew from and the hero's live state", () => {
    const drawn: unknown[] = [];
    const map = { draw: (state: unknown) => drawn.push(state) } as unknown as MapOverlay;
    const hero = new HeroLayer({ x: 10, y: 20, turn: 0 }, 300);
    const frame = { groundTop: 40, rollHeight: 24, footX: 160, footY: 120, phaseX: 0.25, phaseY: -0.5 };
    const bounds = { minX: -10, maxX: 10, minY: -4, maxY: 8 };

    feedMap(map, hero, { frame, pose: { x: 10, y: 20, turn: 0 }, delta: 16, bounds });

    expect(drawn).toEqual([
      expect.objectContaining({
        groundPose: { x: 10, y: 20, turn: 0 },
        phase: { x: 0.25, y: -0.5 },
        bounds,
        radius: 300,
        frameMs: 16,
        progress: 0,
      }),
    ]);
  });
});
