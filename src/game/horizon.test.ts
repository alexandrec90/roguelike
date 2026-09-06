import { describe, expect, it } from "vitest";

import {
  DEFAULT_SKY_FRACTION,
  HORIZON_SCALE,
  horizonLayout,
  MAX_SKY_FRACTION,
  parseSkyFraction,
  ridgeProfile,
  ROLL_ROWS,
  rollBands,
  rollColors,
  rollLift,
  rollPlacement,
  rollScale,
  skyBands,
  SKY_RAMP,
  starField,
} from "./horizon";

describe("the roll's projection", () => {
  it("is exactly full size at the seam with the flat field, so nothing pops", () => {
    expect(rollScale(0)).toBe(1);
    expect(rollLift(0)).toBe(0);
    expect(rollPlacement(0)).toEqual({ lift: 0, scale: 1, beyond: false });
  });

  it("treats a row inside the field as the seam rather than growing past 1", () => {
    expect(rollScale(-3)).toBe(1);
    expect(rollLift(-3)).toBe(0);
  });

  it("reaches the horizon line at exactly HORIZON_SCALE, ROLL_ROWS out", () => {
    expect(rollScale(ROLL_ROWS)).toBeCloseTo(HORIZON_SCALE, 12);
    expect(rollLift(ROLL_ROWS)).toBeCloseTo(1, 12);
    expect(rollPlacement(ROLL_ROWS).beyond).toBe(false);
    expect(rollPlacement(ROLL_ROWS + 0.01).beyond).toBe(true);
  });

  it("shrinks and lifts monotonically, and fastest nearest the field", () => {
    // Perspective: the same step covers more of the screen close up than far
    // off, which is also what makes a thing read as approaching rather than
    // sliding.
    let previousScale = 1;
    let previousLift = 0;
    let previousStep = Number.POSITIVE_INFINITY;
    for (let row = 1; row <= ROLL_ROWS; row += 1) {
      const scale = rollScale(row);
      const lift = rollLift(row);
      expect(scale).toBeLessThan(previousScale);
      expect(lift).toBeGreaterThan(previousLift);
      const step = previousScale - scale;
      expect(step).toBeLessThanOrEqual(previousStep);
      previousScale = scale;
      previousLift = lift;
      previousStep = step;
    }
  });

  it("caps the lift at the horizon line for anything past it", () => {
    expect(rollPlacement(ROLL_ROWS * 3).lift).toBe(1);
    expect(rollLift(ROLL_ROWS * 3)).toBeGreaterThan(1);
  });

  it("honours a different horizon distance and floor", () => {
    expect(rollScale(10, 10, 0.5)).toBeCloseTo(0.5, 12);
    expect(rollScale(5, 10, 0.5)).toBeGreaterThan(0.5);
    expect(rollPlacement(11, 10).beyond).toBe(true);
  });
});

describe("horizonLayout", () => {
  it("gives the default 12% of a 180px target to sky and roll", () => {
    const layout = horizonLayout(180, DEFAULT_SKY_FRACTION);

    expect(layout.bandHeight).toBe(22);
    expect(layout.skyHeight).toBe(15);
    expect(layout.rollHeight).toBe(7);
    expect(layout.horizonY).toBe(15);
    expect(layout.groundTop).toBe(22);
    expect(layout.groundHeight).toBe(158);
  });

  it("splits a 5% band the way the sliver-of-sky version did", () => {
    const layout = horizonLayout(180, 0.05);

    expect(layout.skyHeight).toBe(6);
    expect(layout.rollHeight).toBe(3);
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

describe("rollBands", () => {
  it("compresses the rows out to the horizon into the band's few scanlines", () => {
    const bands = rollBands(3);

    expect(bands).toEqual([
      { row: 1, y: 2, height: 1 },
      { row: 7, y: 1, height: 1 },
      { row: 22, y: 0, height: 1 },
    ]);
  });

  it("puts a scanline's ground where a body standing on it is placed", () => {
    // One curve for both, so the ground under a far tree and the tree agree
    // about their distance: a band's top edge is the lift of its far row.
    for (const band of rollBands(20)) {
      expect(20 - band.y).toBe(Math.round(20 * rollLift(band.row + 1)));
    }
  });

  it("never draws more scanlines than the band has", () => {
    for (const rollHeight of [1, 2, 3, 5, 8, 13, 30]) {
      const bands = rollBands(rollHeight);
      const covered = bands.reduce((total, band) => total + band.height, 0);

      expect(covered).toBe(rollHeight);
      expect(Math.min(...bands.map((band) => band.y))).toBe(0);
    }
  });

  it("gives the nearest rows the most pixels, which is what curving away looks like", () => {
    const bands = rollBands(20, ROLL_ROWS);
    const heights = bands.map((band) => band.height);

    expect(heights[0]).toBeGreaterThan(heights[heights.length - 1] ?? 0);
    expect(bands.map((band) => band.row)).toEqual([...bands.map((band) => band.row)].sort((a, b) => a - b));
  });

  it("draws nothing when there is no band", () => {
    expect(rollBands(0)).toEqual([]);
    expect(rollBands(4, 0)).toEqual([]);
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

  it("hazes the roll toward the horizon by world row, not by band index", () => {
    // Rows that compress to nothing are dropped; keying on the surviving band's
    // index would make the gradient jump wherever that happened.
    const bands = rollBands(3);
    const colors = rollColors(bands);

    expect(colors.map((band) => band.y)).toEqual(bands.map((band) => band.y));
    expect(new Set(colors.map((band) => band.color)).size).toBe(3);
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
