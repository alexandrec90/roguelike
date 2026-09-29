import { describe, expect, it } from "vitest";

import { HERO_EQUIPPED, SWING } from "../models";
import { familyRamp } from "../palette";
import { TRAIL_FROM_MS, TRAIL_SAMPLES, TRAIL_STEP_MS, trailCloud, trailSegments } from "./swing-trail";

const BASE = HERO_EQUIPPED.basePose;
const CONTACT = Math.round(0.45 * SWING.durationMs);

describe("trailSegments", () => {
  it("is empty before the windup peaks and after the swing has settled", () => {
    expect(trailSegments(TRAIL_FROM_MS - 1, BASE)).toEqual([]);
    expect(trailSegments(SWING.durationMs + 1000, BASE)).toEqual([]);
  });

  it("keeps up to the last few blade spans, newest first, aged 0 to 1", () => {
    const segments = trailSegments(CONTACT + 40, BASE);
    expect(segments.length).toBeGreaterThan(2);
    expect(segments.length).toBeLessThanOrEqual(TRAIL_SAMPLES + 1);
    expect(segments[0]?.age).toBe(0);
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index]!.age).toBeGreaterThan(segments[index - 1]!.age);
    }
  });

  it("is a pure function of the swing clock", () => {
    expect(trailSegments(CONTACT, BASE)).toEqual(trailSegments(CONTACT, BASE));
    expect(trailSegments(CONTACT, BASE)).not.toEqual(trailSegments(CONTACT + TRAIL_STEP_MS, BASE));
  });
});

describe("trailCloud", () => {
  const segments = trailSegments(CONTACT, BASE);

  it("fills the sweep in steel, or in fire when the blade burns", () => {
    const steel = trailCloud(segments, false);
    const fire = trailCloud(segments, true);
    const all = (t: typeof steel) => [...t.behind, ...t.front];
    expect(all(steel).length).toBeGreaterThan(10);
    expect(all(steel).every((p) => familyRamp("metal").includes(p.ink as never))).toBe(true);
    expect(all(fire).every((p) => familyRamp("fire").includes(p.ink as never))).toBe(true);
  });

  it("sweeps in front of him at contact", () => {
    const { behind, front } = trailCloud(segments, false);
    expect(front.length).toBeGreaterThan(behind.length);
  });

  it("never paints the same pixel twice", () => {
    const { behind, front } = trailCloud(segments, false);
    const keys = [...behind, ...front].map((p) => `${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("draws nothing from fewer than two samples", () => {
    expect(trailCloud(segments.slice(0, 1), false)).toEqual({ behind: [], front: [] });
  });
});
