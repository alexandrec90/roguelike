import { describe, expect, it } from "vitest";

import {
  DEFAULT_SKY_FRACTION,
  horizonLayout,
  MAX_SKY_FRACTION,
  parseSkyFraction,
  ridgeProfile,
  ROLL_ROWS,
  rollBands,
  rollColors,
  skyBands,
  SKY_RAMP,
} from "./horizon";

describe("horizonLayout", () => {
  it("gives the default 5% of a 180px target to sky and roll", () => {
    const layout = horizonLayout(180, DEFAULT_SKY_FRACTION);

    expect(layout.bandHeight).toBe(9);
    expect(layout.skyHeight).toBe(6);
    expect(layout.rollHeight).toBe(3);
    expect(layout.horizonY).toBe(6);
    expect(layout.groundTop).toBe(9);
    expect(layout.groundHeight).toBe(171);
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
  it("compresses a dozen world rows into the band's few scanlines", () => {
    const bands = rollBands(3);

    expect(bands).toEqual([
      { row: 0, y: 2, height: 1 },
      { row: 1, y: 1, height: 1 },
      { row: 5, y: 0, height: 1 },
    ]);
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
});
