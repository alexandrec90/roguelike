import { describe, expect, it } from "vitest";

import { createWake, IDLE_LAP_MS, STRIDE_TILES, stepWake, type WakeBeat } from "./wake";

/** Walk a wader `tiles` at `perFrame` tiles a frame of 16 ms, collecting the beats. */
function walk(tiles: number, perFrame: number, wet = true): WakeBeat[] {
  const wake = createWake();
  const beats: WakeBeat[] = [];
  const frames = Math.round(tiles / perFrame);
  for (let frame = 0; frame <= frames; frame += 1) {
    // Half a frame's walk past the mark, so a sum of floats cannot fall just short of a footfall.
    const beat = stepWake(wake, frame * perFrame + perFrame / 2, wet, 16);
    if (beat !== undefined) {
      beats.push(beat);
    }
  }
  return beats;
}

describe("stepWake", () => {
  it("splashes once per footfall, whatever the speed", () => {
    const slow = walk(6, 0.05).filter((beat) => beat.kind === "step");
    const fast = walk(6, 0.2).filter((beat) => beat.kind === "step");
    // Stepping in, then one more each stride.
    expect(slow).toHaveLength(6 / STRIDE_TILES + 1);
    expect(fast).toHaveLength(slow.length);
  });

  it("alternates feet", () => {
    const sides = walk(4, 0.1).flatMap((beat) => (beat.kind === "step" ? [beat.side] : []));
    for (let index = 1; index < sides.length; index += 1) {
      expect(sides[index]).toBe(-(sides[index - 1] ?? 0));
    }
  });

  it("is silent on dry ground", () => {
    expect(walk(5, 0.1, false)).toEqual([]);
  });

  it("splashes on stepping in, even mid-stride", () => {
    const wake = createWake();
    expect(stepWake(wake, 2.4, false, 16)).toBeUndefined();
    expect(stepWake(wake, 2.5, true, 16)?.kind).toBe("step");
    expect(stepWake(wake, 2.6, true, 16)).toBeUndefined();
  });

  it("laps round a wader standing still, at its own slow rate", () => {
    const wake = createWake();
    stepWake(wake, 3, true, 16);
    const beats: WakeBeat[] = [];
    const framesPerLap = Math.ceil(IDLE_LAP_MS / 16);
    for (let frame = 0; frame < framesPerLap * 3; frame += 1) {
      const beat = stepWake(wake, 3, true, 16);
      if (beat !== undefined) {
        beats.push(beat);
      }
    }
    expect(beats).toEqual([{ kind: "lap" }, { kind: "lap" }, { kind: "lap" }]);
  });

  it("forgets the stillness the moment it walks on", () => {
    const wake = createWake();
    stepWake(wake, 3, true, 16);
    stepWake(wake, 3, true, IDLE_LAP_MS - 20);
    stepWake(wake, 3.05, true, 16);
    expect(stepWake(wake, 3.05, true, 16)).toBeUndefined();
  });
});
