import { describe, expect, it } from "vitest";

import {
  atmosphereAt,
  clockHours,
  DEFAULT_DAY_MS,
  DEFAULT_START_HOURS,
  parseDayLength,
  parseTime,
} from "./atmosphere";
import { hexToRgb } from "./color";

function brightness(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return r + g + b;
}

describe("the day", () => {
  it("is fully lit at noon and moonlit at midnight", () => {
    const noon = atmosphereAt(13);
    const midnight = atmosphereAt(0);
    expect(noon.ambient).toBe("#ffffff");
    expect(noon.daylight).toBe(1);
    expect(midnight.daylight).toBe(0);
    expect(brightness(midnight.ambient)).toBeLessThan(brightness(noon.ambient) * 0.6);
    // Moonlit, not black: a night the player cannot see is a bug report.
    expect(brightness(midnight.ambient)).toBeGreaterThan(200);
  });

  it("puts the stars out by day and in by night", () => {
    expect(atmosphereAt(12).starAlpha).toBe(0);
    expect(atmosphereAt(1).starAlpha).toBeGreaterThan(0.9);
  });

  it("warms the light at sunset", () => {
    const { r, b } = hexToRgb(atmosphereAt(18.25).ambient);
    expect(r).toBeGreaterThan(b + 40);
  });

  it("wraps hours past 24 and below 0", () => {
    expect(atmosphereAt(25).hours).toBeCloseTo(1, 6);
    expect(atmosphereAt(-1).hours).toBeCloseTo(23, 6);
  });
});

describe("the light's arc", () => {
  it("rises on the left, stands overhead at midday and sets on the right", () => {
    const morning = atmosphereAt(7.5).light;
    const midday = atmosphereAt(12.5).light;
    const evening = atmosphereAt(17.5).light;
    expect(morning.x).toBeLessThan(-0.3);
    expect(Math.abs(midday.x)).toBeLessThan(0.1);
    expect(evening.x).toBeGreaterThan(0.3);
    for (const light of [morning, midday, evening]) {
      expect(light.y).toBeLessThan(0);
      expect(Math.hypot(light.x, light.y)).toBeCloseTo(1, 6);
    }
  });

  it("is highest at midday and never flat on the horizon", () => {
    expect(atmosphereAt(12.5).elevation).toBeGreaterThan(atmosphereAt(8).elevation);
    for (let hour = 0; hour < 24; hour += 0.5) {
      expect(atmosphereAt(hour).elevation).toBeGreaterThanOrEqual(0.2);
    }
  });

  it("casts weaker shadows by moonlight and under cloud", () => {
    expect(atmosphereAt(1).shadowStrength).toBeLessThan(atmosphereAt(12).shadowStrength);
    expect(atmosphereAt(12, 1).shadowStrength).toBeLessThan(atmosphereAt(12, 0).shadowStrength);
  });
});

describe("overcast", () => {
  it("dims and greys the day", () => {
    expect(brightness(atmosphereAt(12, 1).ambient)).toBeLessThan(brightness(atmosphereAt(12).ambient));
    expect(atmosphereAt(12, 5).overcast).toBe(1);
  });
});

describe("the clock", () => {
  it("starts in the late afternoon and runs a day in `DEFAULT_DAY_MS`", () => {
    expect(clockHours(0)).toBe(DEFAULT_START_HOURS);
    expect(clockHours(DEFAULT_DAY_MS)).toBeCloseTo(DEFAULT_START_HOURS, 6);
    expect(clockHours(DEFAULT_DAY_MS / 4, 0)).toBeCloseTo(6, 6);
  });
});

describe("reading the query", () => {
  it("pins the clock from an hour or hh:mm, and ignores nonsense", () => {
    expect(parseTime("21")).toBe(21);
    expect(parseTime("6.5")).toBe(6.5);
    expect(parseTime("18:30")).toBe(18.5);
    expect(parseTime("24")).toBe(0);
    expect(parseTime(null)).toBeUndefined();
    expect(parseTime("")).toBeUndefined();
    expect(parseTime("dusk")).toBeUndefined();
    expect(parseTime("31")).toBeUndefined();
  });

  it("reads a day length in seconds, with a floor", () => {
    expect(parseDayLength("120")).toBe(120_000);
    expect(parseDayLength("3")).toBe(DEFAULT_DAY_MS);
    expect(parseDayLength(null)).toBe(DEFAULT_DAY_MS);
  });
});
