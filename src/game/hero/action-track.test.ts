import { describe, expect, it } from "vitest";

import { advanceTrack } from "./action-track";

describe("advanceTrack", () => {
  it("stays free while nothing is wanted", () => {
    expect(advanceTrack(undefined, false, 16, 100, 50)).toEqual({ ms: undefined, started: false, beat: false });
  });

  it("starts at zero when wanted and free", () => {
    expect(advanceTrack(undefined, true, 16, 100, 50)).toEqual({ ms: 0, started: true, beat: false });
  });

  it("ages a running action and ignores the want until it ends", () => {
    expect(advanceTrack(10, true, 16, 100, 50)).toEqual({ ms: 26, started: false, beat: false });
  });

  it("reports the beat on the frame that crosses it, and only that one", () => {
    expect(advanceTrack(40, false, 10, 100, 50).beat).toBe(true);
    expect(advanceTrack(50, false, 10, 100, 50).beat).toBe(false);
    expect(advanceTrack(30, false, 10, 100, 50).beat).toBe(false);
  });

  it("restarts with the overshoot carried when still wanted at the end", () => {
    expect(advanceTrack(95, true, 10, 100, 50)).toEqual({ ms: 5, started: true, beat: false });
  });

  it("frees the track at the end when no longer wanted", () => {
    expect(advanceTrack(95, false, 10, 100, 50).ms).toBeUndefined();
  });

  it("caps the carry at one cycle however long the tab slept", () => {
    const tick = advanceTrack(0, true, 10_000, 100, 50);
    expect(tick.ms).toBe(100);
    // The old action passed its beat on the way out.
    expect(tick.beat).toBe(true);
  });

  it("never runs backwards on a negative delta", () => {
    expect(advanceTrack(20, false, -50, 100, 50).ms).toBe(20);
  });
});
