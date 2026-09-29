import { describe, expect, it } from "vitest";

import { TILE_DEPTH } from "./projection";

import {
  DEFAULT_SKY_FRACTION,
  HORIZON_SCALE,
  horizonLayout,
  MAX_SKY_FRACTION,
  parseSkyFraction,
  ridgeProfile,
  ROLL_FAR_COLOR,
  ROLL_NEAR_COLOR,
  ROLL_ROWS,
  rollHaze,
  rollKnee,
  rollLift,
  rollPlacement,
  rollRowAt,
  rollScale,
  skyBands,
  SKY_RAMP,
  starField,
} from "./horizon";

/** The default roll: 24 scanlines on a 180px target. */
const ROLL = 24;

describe("the roll's projection", () => {
  it("is exactly full size at the seam with the flat field, so nothing pops", () => {
    expect(rollScale(0, ROLL)).toBe(1);
    expect(rollLift(0, ROLL)).toBe(0);
    expect(rollPlacement(0, ROLL)).toEqual({ lift: 0, scale: 1, beyond: false });
  });

  it("treats a row inside the field as the seam rather than growing past 1", () => {
    expect(rollScale(-3, ROLL)).toBe(1);
    expect(rollLift(-3, ROLL)).toBe(0);
  });

  it("starts the lip at the flat field's own slope, so there is no crease", () => {
    // The treadmill: a row just past the seam is TILE_DEPTH scanlines tall,
    // exactly like the flat row before it.
    for (const rollHeight of [8, 24, 40]) {
      const epsilon = 1e-6;
      const slope = (rollHeight * rollLift(epsilon, rollHeight)) / epsilon;
      expect(slope).toBeCloseTo(TILE_DEPTH, 3);
    }
  });

  it("begins to curve with zero slope, then compresses every row further than the last", () => {
    const rowHeight = (row: number): number =>
      ROLL * (rollLift(row + 0.01, ROLL) - rollLift(row, ROLL)) / 0.01;
    // Flat to begin with: the second hundredth of a row is as tall as the first.
    expect(rowHeight(0.01)).toBeCloseTo(rowHeight(0), 1);
    let previous = Number.POSITIVE_INFINITY;
    for (let row = 0.5; row <= ROLL_ROWS; row += 0.5) {
      const height = rowHeight(row);
      expect(height).toBeLessThan(previous);
      previous = height;
    }
  });

  it("keeps a body's size for the first stretch of the lip before it recedes", () => {
    // The shrink inherits the squash's zero slope: the first tenth of a row
    // past the seam costs a body under a percent of its size.
    expect(rollScale(0.1, ROLL)).toBeGreaterThan(0.99);
    expect(rollScale(3, ROLL)).toBeLessThan(0.7);
  });

  it("reaches the horizon line at exactly HORIZON_SCALE, ROLL_ROWS out", () => {
    expect(rollScale(ROLL_ROWS, ROLL)).toBeCloseTo(HORIZON_SCALE, 12);
    expect(rollLift(ROLL_ROWS, ROLL)).toBeCloseTo(1, 12);
    expect(rollPlacement(ROLL_ROWS, ROLL).beyond).toBe(false);
    expect(rollPlacement(ROLL_ROWS + 0.01, ROLL).beyond).toBe(true);
  });

  it("shrinks and lifts monotonically all the way to the horizon", () => {
    let previousScale = 1;
    let previousLift = 0;
    for (let row = 1; row <= ROLL_ROWS; row += 1) {
      const scale = rollScale(row, ROLL);
      const lift = rollLift(row, ROLL);
      expect(scale).toBeLessThan(previousScale);
      expect(lift).toBeGreaterThan(previousLift);
      previousScale = scale;
      previousLift = lift;
    }
  });

  it("caps the lift at the horizon line for anything past it", () => {
    expect(rollPlacement(ROLL_ROWS * 3, ROLL).lift).toBe(1);
    expect(rollLift(ROLL_ROWS * 3, ROLL)).toBeGreaterThan(1);
  });

  it("honours a different horizon distance and floor", () => {
    expect(rollScale(10, ROLL, 10, 0.5)).toBeCloseTo(0.5, 12);
    expect(rollScale(5, ROLL, 10, 0.5)).toBeGreaterThan(0.5);
    expect(rollPlacement(11, ROLL, 10).beyond).toBe(true);
  });

  it("inverts the lift, so a scanline and a body agree about which row it is", () => {
    for (const row of [0.05, 0.5, 1, 3, 10, 30, ROLL_ROWS]) {
      expect(rollRowAt(rollLift(row, ROLL), ROLL)).toBeCloseTo(row, 6);
    }
    expect(rollRowAt(0, ROLL)).toBe(0);
  });

  it("gives a taller roll a gentler lip", () => {
    expect(rollKnee(40)).toBeGreaterThan(rollKnee(24));
    expect(rollKnee(24)).toBeGreaterThan(rollKnee(8));
    // Two rows' worth of scanlines bends over roughly the first row and a bit.
    expect(rollKnee(ROLL)).toBeGreaterThan(1);
    expect(rollKnee(ROLL)).toBeLessThan(1.5);
  });

  it("puts everything past the seam on the horizon line when there is no roll", () => {
    expect(rollKnee(0)).toBe(0);
    expect(rollLift(2, 0)).toBe(1);
    expect(rollScale(2, 0)).toBe(HORIZON_SCALE);
    expect(rollRowAt(0.5, 0)).toBe(0);
  });

  it("saturates rather than failing for a roll taller than the rows could fill", () => {
    const knee = rollKnee(TILE_DEPTH * ROLL_ROWS * 2);
    expect(Number.isFinite(knee)).toBe(true);
    expect(rollLift(ROLL_ROWS, TILE_DEPTH * ROLL_ROWS * 2)).toBeCloseTo(1, 9);
  });
});

describe("horizonLayout", () => {
  it("gives the default 22% of a 180px target to sky and roll", () => {
    const layout = horizonLayout(180, DEFAULT_SKY_FRACTION);

    expect(layout.bandHeight).toBe(40);
    expect(layout.skyHeight).toBe(16);
    expect(layout.rollHeight).toBe(24);
    expect(layout.horizonY).toBe(16);
    expect(layout.groundTop).toBe(40);
    expect(layout.groundHeight).toBe(140);
  });

  it("gives the default roll two rows' worth of scanlines, room for the lip to bend", () => {
    expect(horizonLayout(180).rollHeight).toBeGreaterThanOrEqual(2 * TILE_DEPTH);
  });

  it("splits a 5% band into sky and roll", () => {
    const layout = horizonLayout(180, 0.05);

    expect(layout.skyHeight).toBe(4);
    expect(layout.rollHeight).toBe(5);
  });

  it("leaves room in the default sky for a tree standing on the horizon line", () => {
    // The reason the default grew: a body on the horizon is HORIZON_SCALE of
    // its full height, and the chestnut is 58 logical pixels tall.
    const layout = horizonLayout(180, DEFAULT_SKY_FRACTION);
    expect(layout.skyHeight).toBeGreaterThanOrEqual(Math.ceil(58 * HORIZON_SCALE));
  });

  it("keeps the band and the playfield exactly covering the target", () => {
    for (const fraction of [0, 0.02, 0.05, 0.12, 0.3, 0.5]) {
      const layout = horizonLayout(180, fraction);

      expect(layout.skyHeight + layout.rollHeight).toBe(layout.bandHeight);
      expect(layout.bandHeight + layout.groundHeight).toBe(180);
      expect(layout.groundTop).toBe(layout.bandHeight);
      expect(layout.horizonY).toBe(layout.skyHeight);
    }
  });

  it("never produces a band with sky but no roll, or the reverse", () => {
    for (let fraction = 0.005; fraction <= MAX_SKY_FRACTION; fraction += 0.005) {
      const layout = horizonLayout(180, fraction);

      expect(layout.skyHeight).toBeGreaterThanOrEqual(1);
      expect(layout.rollHeight).toBeGreaterThanOrEqual(1);
    }
  });

  it("takes 0 to mean no band at all", () => {
    const layout = horizonLayout(180, 0);

    expect(layout.bandHeight).toBe(0);
    expect(layout.groundHeight).toBe(180);
  });

  it("clamps past the point where the flat read is gone", () => {
    expect(horizonLayout(180, 0.9).skyFraction).toBe(MAX_SKY_FRACTION);
    expect(horizonLayout(180, 0.9).bandHeight).toBe(90);
  });

  it("rejects a target with no height rather than silently drawing nothing", () => {
    expect(() => horizonLayout(0)).toThrow(/positive/);
    expect(() => horizonLayout(Number.NaN)).toThrow(/positive/);
  });

  it("moves the split without changing the playfield's projection", () => {
    // The whole point of the knob: retuning it reframes, it does not re-project.
    const tight = horizonLayout(180, 0.05);
    const wide = horizonLayout(180, 0.2);

    expect(wide.groundTop - tight.groundTop).toBe(wide.bandHeight - tight.bandHeight);
    expect(tight.groundHeight - wide.groundHeight).toBe(wide.bandHeight - tight.bandHeight);
  });
});

describe("parseSkyFraction", () => {
  it("reads a decimal and a percentage the same way", () => {
    expect(parseSkyFraction("0.08")).toBeCloseTo(0.08);
    expect(parseSkyFraction("8%")).toBeCloseTo(0.08);
    expect(parseSkyFraction("  12% ")).toBeCloseTo(0.12);
  });

  it("falls back rather than throwing, because this comes from a URL", () => {
    expect(parseSkyFraction(null)).toBe(DEFAULT_SKY_FRACTION);
    expect(parseSkyFraction("")).toBe(DEFAULT_SKY_FRACTION);
    expect(parseSkyFraction("wide")).toBe(DEFAULT_SKY_FRACTION);
    expect(parseSkyFraction(undefined, 0.1)).toBe(0.1);
  });

  it("clamps the same way the layout does", () => {
    expect(parseSkyFraction("0.9")).toBe(MAX_SKY_FRACTION);
    expect(parseSkyFraction("-3")).toBe(0);
  });
});

describe("the band's colours", () => {
  it("gives one exact scanline per row of sky", () => {
    const bands = skyBands(6);

    expect(bands).toHaveLength(6);
    expect(bands.map((band) => band.y)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(bands[0]?.color).toBe(SKY_RAMP[0]);
    expect(bands[5]?.color).toBe(SKY_RAMP[SKY_RAMP.length - 1]);
  });

  it("hazes the roll from the near colour at the seam to the far one on the horizon", () => {
    expect(rollHaze(0)).toBe(ROLL_NEAR_COLOR);
    expect(rollHaze(ROLL_ROWS)).toBe(ROLL_FAR_COLOR);
    expect(rollHaze(-4)).toBe(ROLL_NEAR_COLOR);
    expect(rollHaze(ROLL_ROWS * 2)).toBe(ROLL_FAR_COLOR);
    expect(rollHaze(ROLL_ROWS / 2)).not.toBe(rollHaze(0));
  });

  it("draws no sky when the band is zero", () => {
    expect(skyBands(0)).toEqual([]);
  });
});

describe("ridgeProfile", () => {
  it("is seeded, so a capture of the horizon is reproducible", () => {
    expect(ridgeProfile(320, { seed: 7 })).toEqual(ridgeProfile(320, { seed: 7 }));
    expect(ridgeProfile(320, { seed: 7 })).not.toEqual(ridgeProfile(320, { seed: 8 }));
  });

  it("never pokes out of the top of the sky band", () => {
    const profile = ridgeProfile(320, { maxHeight: 6, amplitude: 40, base: 30 });

    expect(Math.max(...profile)).toBeLessThanOrEqual(6);
    expect(Math.min(...profile)).toBeGreaterThanOrEqual(0);
  });

  it("is whole pixels, and actually varies", () => {
    const profile = ridgeProfile(320, { seed: 3 });

    expect(profile.every((height) => Number.isInteger(height))).toBe(true);
    expect(new Set(profile).size).toBeGreaterThan(1);
  });

  it("rejects a wavelength that would divide by zero", () => {
    expect(() => ridgeProfile(10, { wavelength: 0 })).toThrow(/wavelength/);
    expect(() => ridgeProfile(-1)).toThrow(/negative/);
  });

  it("leaves an unwrapped profile exactly as it was", () => {
    // `period` is opt-in: the open profile is what every non-panorama caller
    // still gets, and it must not shift because a new option exists.
    expect(ridgeProfile(320, { seed: 7, period: 0 })).toEqual(ridgeProfile(320, { seed: 7 }));
  });

  it("closes on itself when given a period, at both octaves", () => {
    // A ridge that scrolls round a full turn has to meet itself. Open noise
    // looks identical on screen and hides a cliff at one bearing, once a lap.
    const period = 640;
    const profile = ridgeProfile(period * 2, { seed: 7, wavelength: 55, period });

    for (let x = 0; x < period; x += 1) {
      expect(profile[x + period]).toBe(profile[x]);
    }
  });

  it("still varies once it has been folded into a loop", () => {
    const profile = ridgeProfile(640, { seed: 11, wavelength: 55, period: 640 });
    expect(new Set(profile).size).toBeGreaterThan(1);
  });
});

describe("starField", () => {
  it("is seeded, so a capture of the sky is reproducible", () => {
    expect(starField(320, 6)).toEqual(starField(320, 6));
    expect(starField(320, 6, 1)).not.toEqual(starField(320, 6, 2));
  });

  it("stays inside the sky band and scales with its area", () => {
    const stars = starField(320, 6);
    expect(stars.every((star) => star.x >= 0 && star.x < 320 && star.y >= 0 && star.y < 6)).toBe(
      true,
    );
    expect(stars.length).toBeGreaterThan(starField(320, 3).length);
    expect(starField(320, 0)).toEqual([]);
  });

  it("marks a minority of stars bright", () => {
    const stars = starField(320, 40);
    const bright = stars.filter((star) => star.bright).length;
    expect(bright).toBeGreaterThan(0);
    expect(bright).toBeLessThan(stars.length / 2);
  });
});
