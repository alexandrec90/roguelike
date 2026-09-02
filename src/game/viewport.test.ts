import { describe, expect, it } from "vitest";

import { cellFoot } from "./field";
import { horizonLayout, DEFAULT_SKY_FRACTION } from "./horizon";
import { visibleHeight, visibleRows, walkableBand } from "./viewport";

const GROUND_TOP = horizonLayout(180, DEFAULT_SKY_FRACTION).groundTop;

describe("visibleHeight", () => {
  it("is the whole target when the window is exactly covered", () => {
    expect(visibleHeight(1080, 6, 180)).toBe(180);
  });

  it("is what survives the crop when the window is shorter than the canvas", () => {
    // 1920x600: the cover factor is still 6 because the width demands it, so
    // the 1080px-tall canvas loses its bottom 480px — 80 logical scanlines.
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

describe("visibleRows", () => {
  it("counts only the rows whose feet the band still holds", () => {
    // A row's foot is the last of its 12 scanlines, so a band 24 deep holds
    // exactly two rows and a band one scanline short of that holds one.
    expect(visibleRows({ top: 9, bottom: 33 })).toBe(2);
    expect(visibleRows({ top: 9, bottom: 32 })).toBe(1);
  });

  it("agrees with cellFoot about where the last row it counted ends", () => {
    for (let visible = 30; visible <= 180; visible += 1) {
      const band = walkableBand(GROUND_TOP, visible);
      const rows = visibleRows(band);

      expect(cellFoot(0, rows - 1, band.top).y).toBeLessThanOrEqual(band.bottom);
      expect(cellFoot(0, rows, band.top).y).toBeGreaterThan(band.bottom);
    }
  });

  it("gives up fewer rows the taller the window is", () => {
    expect(visibleRows(walkableBand(GROUND_TOP, 100))).toBeLessThan(
      visibleRows(walkableBand(GROUND_TOP, 180)),
    );
  });

  it("keeps one row for a window too short to hold even that", () => {
    // The hero then hangs over the near edge, which is honest about the
    // window; a field of no rows would be nowhere for him to be at all.
    expect(visibleRows(walkableBand(GROUND_TOP, 4))).toBe(1);
    expect(visibleRows({ top: 9, bottom: 10 })).toBe(1);
  });

  it("leaves the whole map walkable at the height the scene is drawn for", () => {
    // 1920x1080 covers the target exactly: nothing is cropped, so nothing the
    // field draws should be fenced off.
    const rows = visibleRows(walkableBand(GROUND_TOP, visibleHeight(1080, 6, 180)));

    expect(cellFoot(0, rows - 1, GROUND_TOP).y).toBeLessThanOrEqual(180);
  });
});
