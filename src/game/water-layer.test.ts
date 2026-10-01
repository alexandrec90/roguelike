import { describe, expect, it } from "vitest";

import type { CameraFrame } from "./camera";
import { toLocal, type PlanetPose } from "./planet";
import { puddlesNear } from "./terrain";
import { growPuddles } from "./water-layer";

const FRAME: CameraFrame = { groundTop: 40, rollHeight: 24, footX: 160, footY: 113, phaseX: 0, phaseY: 0 };
const POSE: PlanetPose = { x: 124, y: 80, turn: 0.4 };

describe("growPuddles", () => {
  it("grows one puddle per site in reach, centred where the field puts the site", () => {
    const sites = puddlesNear(POSE, 20);
    const puddles = growPuddles(FRAME, POSE, 20, 1);
    expect(puddles).toHaveLength(sites.length);
    expect(puddles.length).toBeGreaterThan(0);
    const first = sites[0];
    const local = first === undefined ? { x: 0, y: 0 } : toLocal(POSE, first);
    expect(puddles[0]?.centerX).toBe(Math.round(FRAME.footX + local.x * 16));
    expect(puddles[0]?.centerY).toBe(Math.round(FRAME.footY - local.y * 12));
  });

  it("ignores the stride in flight: puddles are laid out on the zero-phase grid", () => {
    expect(growPuddles({ ...FRAME, phaseX: 0.4, phaseY: 0.7 }, POSE, 20, 1)).toEqual(growPuddles(FRAME, POSE, 20, 1));
  });

  it("passes over a site its caller cannot see before tracing its outline", () => {
    const ahead = growPuddles(FRAME, POSE, 20, 1, { keep: (local) => local.y > 0 });
    const all = growPuddles(FRAME, POSE, 20, 1);
    expect(ahead.length).toBeLessThan(all.length);
    expect(ahead.every((puddle) => puddle.centerY < FRAME.footY)).toBe(true);
  });

  it("sweeps a disc round a local point when asked, for a reach that is not centred on the hero", () => {
    const far = growPuddles(FRAME, POSE, 10, 1, { around: { x: 0, y: 30 } });
    expect(far.length).toBeGreaterThan(0);
    expect(far.every((puddle) => FRAME.footY - puddle.centerY > 19 * 12)).toBe(true);
  });

  it("swells every puddle with the wet weather's scale", () => {
    const dry = growPuddles(FRAME, POSE, 20, 1);
    const wet = growPuddles(FRAME, POSE, 20, 1.5);
    expect(wet.reduce((sum, puddle) => sum + puddle.water.length, 0)).toBeGreaterThan(
      dry.reduce((sum, puddle) => sum + puddle.water.length, 0),
    );
  });
});
