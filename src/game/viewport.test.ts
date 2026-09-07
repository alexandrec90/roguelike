import { describe, expect, it } from "vitest";

import { DEFAULT_SKY_FRACTION, horizonLayout } from "./horizon";
import { anchorFoot, visibleHeight, walkableBand } from "./viewport";

const GROUND_TOP = horizonLayout(180, DEFAULT_SKY_FRACTION).groundTop;
const HERO = 26;

describe("visibleHeight", () => {
  it("is the whole target when the window is exactly covered", () => {
    expect(visibleHeight(1080, 6, 180)).toBe(180);
  });

  it("is what survives the crop when the window is shorter than the canvas", () => {
    // 1920x600: the cover factor is still 6 because the width demands it, so
    // the 1080px-tall canvas loses its bottom 480px - 80 logical scanlines.
    expect(visibleHeight(600, 6, 180)).toBe(100);
  });

  it("never exceeds the target, however tall the window", () => {
    expect(visibleHeight(4000, 6, 180)).toBe(180);
  });

  it("falls back to the whole target for a window that has no size yet", () => {
    expect(visibleHeight(0, 6, 180)).toBe(180);
    expect(visibleHeight(Number.NaN, 6, 180)).toBe(180);
  });

  it("rejects a factor that could not have come from a cover scale", () => {
    expect(() => visibleHeight(600, 0, 180)).toThrow(/positive/);
  });
});

describe("walkableBand", () => {
  it("runs from the foot of the horizon roll to the last visible scanline", () => {
    expect(walkableBand(9, 100)).toEqual({ top: 9, bottom: 100 });
  });

  it("keeps one scanline when the window is shorter than the horizon band", () => {
    // Inverting instead would put the hero *above* the horizon, which reads as
    // a drawing bug rather than as a window nobody can play in.
    expect(walkableBand(9, 4)).toEqual({ top: 9, bottom: 10 });
  });
});

describe("anchorFoot", () => {
  it("centres the silhouette in the band, not the origin", () => {
    // Feet at the middle would hang the whole body above it; the middle of the
    // *drawing* is what the eye reads as centred.
    const band = walkableBand(GROUND_TOP, 180);
    const foot = anchorFoot(band, 320, HERO);
    const head = foot.y - HERO;

    // Within a pixel: a band and a hero of opposite parity cannot split evenly.
    expect(Math.abs(head - band.top - (band.bottom - foot.y))).toBeLessThanOrEqual(1);
  });

  it("sits on whole pixels at the middle column", () => {
    const foot = anchorFoot(walkableBand(GROUND_TOP, 180), 320, HERO);
    expect(foot.x).toBe(160);
    expect(Number.isInteger(foot.y)).toBe(true);
  });

  it("keeps the whole hero inside the band at every window height that can hold him", () => {
    // From the first window tall enough for the band to fit him; shorter
    // ones are the "keep the head" case below, and cannot hold all of him.
    for (let visible = GROUND_TOP + HERO; visible <= 180; visible += 1) {
      const band = walkableBand(GROUND_TOP, visible);
      const foot = anchorFoot(band, 320, HERO);

      expect(foot.y).toBeGreaterThan(band.top);
      expect(foot.y).toBeLessThanOrEqual(band.bottom);
      expect(foot.y - HERO).toBeGreaterThanOrEqual(band.top);
    }
  });

  it("rises as the window shortens, rather than following the vanished rows", () => {
    const tall = anchorFoot(walkableBand(GROUND_TOP, 180), 320, HERO);
    const short = anchorFoot(walkableBand(GROUND_TOP, 100), 320, HERO);
    expect(short.y).toBeLessThan(tall.y);
  });

  it("keeps the head when the band is too short to hold him", () => {
    // A hero cropped at the ankles still reads as a hero; one cropped at the
    // neck reads as a bug. So the feet go under the edge, not the head over it.
    const band = walkableBand(GROUND_TOP, GROUND_TOP + 10);
    const foot = anchorFoot(band, 320, HERO);

    expect(foot.y - HERO).toBe(band.top);
    expect(foot.y).toBeGreaterThan(band.bottom);
  });
});
