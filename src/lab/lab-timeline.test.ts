import { describe, expect, it } from "vitest";

import { clipDurationMs, frameIndexAt, stepFrame, timeForFrame } from "./lab-timeline";

describe("frameIndexAt", () => {
  it("holds each frame for its full duration", () => {
    expect(frameIndexAt(0, 4, 100)).toBe(0);
    expect(frameIndexAt(99, 4, 100)).toBe(0);
    expect(frameIndexAt(100, 4, 100)).toBe(1);
  });

  it("loops back to the first frame", () => {
    expect(frameIndexAt(400, 4, 100)).toBe(0);
    expect(frameIndexAt(450, 4, 100)).toBe(0);
    expect(frameIndexAt(550, 4, 100)).toBe(1);
  });

  it("runs the clip backwards for negative time", () => {
    expect(frameIndexAt(-50, 4, 100)).toBe(3);
  });

  it("pins a single-frame clip", () => {
    expect(frameIndexAt(99999, 1, 100)).toBe(0);
  });

  it("rejects a clip that cannot advance", () => {
    expect(() => frameIndexAt(0, 0, 100)).toThrow(/at least one frame/);
    expect(() => frameIndexAt(0, 4, 0)).toThrow(/greater than zero/);
  });
});

describe("clipDurationMs", () => {
  it("is the sum of the frame holds", () => {
    expect(clipDurationMs(4, 140)).toBe(560);
  });
});

describe("timeForFrame", () => {
  it("parks the clock at the start of the frame's hold", () => {
    expect(timeForFrame(2, 140)).toBe(280);
    expect(frameIndexAt(timeForFrame(2, 140), 4, 140)).toBe(2);
  });

  it("rejects a zero duration", () => {
    expect(() => timeForFrame(1, 0)).toThrow(/greater than zero/);
  });
});

describe("stepFrame", () => {
  it("wraps forwards past the last frame", () => {
    expect(stepFrame(3, 1, 4)).toBe(0);
  });

  it("wraps backwards past the first", () => {
    expect(stepFrame(0, -1, 4)).toBe(3);
  });

  it("handles a step larger than the clip", () => {
    expect(stepFrame(0, 9, 4)).toBe(1);
  });

  it("rejects an empty clip", () => {
    expect(() => stepFrame(0, 1, 0)).toThrow(/at least one frame/);
  });
});
