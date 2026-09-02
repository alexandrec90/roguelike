import { describe, expect, it } from "vitest";

import { horizonLayout, DEFAULT_SKY_FRACTION } from "./horizon";
import { cloudBounds } from "./ink";
import { HERO_EQUIPPED } from "./models";
import { renderModel } from "./rig";
import { centerFoot, visibleHeight, walkableBand } from "./viewport";

const GROUND_TOP = horizonLayout(180, DEFAULT_SKY_FRACTION).groundTop;

/** A cloud 10 wide and 20 tall standing on its origin, like every rig model. */
const STANDING = { left: -5, right: 4, top: -19, bottom: 0 };

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

describe("centerFoot", () => {
  it("centres the cloud's span on the middle of the band", () => {
    const foot = centerFoot(STANDING, { top: 9, bottom: 180 }, 160);

    // An even-width cloud cannot straddle a pixel column, so half a pixel is
    // the floor on both axes once the origin is snapped.
    const across = foot.x + (STANDING.left + STANDING.right) / 2;
    expect(Math.abs(across - 160)).toBeLessThanOrEqual(0.5);
    const down = foot.y + (STANDING.top + STANDING.bottom) / 2;
    expect(Math.abs(down - (9 + 180) / 2)).toBeLessThanOrEqual(0.5);
  });

  it("moves the cloud up the screen as the window clips the near rows", () => {
    const tall = centerFoot(STANDING, walkableBand(GROUND_TOP, 180), 160);
    const short = centerFoot(STANDING, walkableBand(GROUND_TOP, 100), 160);

    expect(short.y).toBeLessThan(tall.y);
    expect(short.x).toBe(tall.x);
  });

  it("keeps the whole cloud inside the band at every window height", () => {
    for (let visible = 60; visible <= 180; visible += 1) {
      const band = walkableBand(GROUND_TOP, visible);
      const foot = centerFoot(STANDING, band, 160);

      expect(foot.y + STANDING.top).toBeGreaterThanOrEqual(band.top);
      expect(foot.y + STANDING.bottom).toBeLessThanOrEqual(band.bottom);
    }
  });

  it("pins the head rather than the feet when the band is too short to fit", () => {
    const band = { top: 9, bottom: 20 };
    const foot = centerFoot(STANDING, band, 160);

    // Losing the feet reads as standing behind the near edge; losing the head
    // reads as a decapitation, so the head is what stays.
    expect(foot.y + STANDING.top).toBe(band.top);
  });

  it("returns whole pixels, because a half-pixel origin smears the cloud", () => {
    const foot = centerFoot(STANDING, { top: 9, bottom: 100 }, 160);

    expect(Number.isInteger(foot.x)).toBe(true);
    expect(Number.isInteger(foot.y)).toBe(true);
  });

  it("falls back to the band's middle for a cloud with no pixels in it", () => {
    expect(centerFoot(null, { top: 10, bottom: 20 }, 160)).toEqual({ x: 160, y: 15 });
  });

  it("puts the real hero in the middle of the real playfield", () => {
    // The end-to-end claim: the rig the scene draws, at the split it draws it
    // at, lands wholly below the horizon and centred on the target.
    const bounds = cloudBounds(renderModel(HERO_EQUIPPED, HERO_EQUIPPED.basePose));
    expect(bounds).not.toBeNull();
    const band = walkableBand(GROUND_TOP, 180);
    const foot = centerFoot(bounds, band, 160);

    expect(foot.y + (bounds?.top ?? 0)).toBeGreaterThanOrEqual(band.top);
    expect(foot.y + (bounds?.bottom ?? 0)).toBeLessThanOrEqual(band.bottom);
    // Snapping the origin to a whole pixel can leave the silhouette half a
    // pixel off centre; anything more than that is a placement bug.
    const middle = foot.x + ((bounds?.left ?? 0) + (bounds?.right ?? 0)) / 2;
    expect(Math.abs(middle - 160)).toBeLessThanOrEqual(0.5);
  });
});
