import { describe, expect, it } from "vitest";

import {
  FAIR_OPENING_MS,
  parseWeather,
  puddleScale,
  stepWetness,
  WEATHER_CYCLE_MS,
  WEATHER_PRESETS,
  weatherAt,
  type WeatherState,
} from "./schedule";

function sweep(fromMs: number, toMs: number, stepMs: number): WeatherState[] {
  const states: WeatherState[] = [];
  for (let ms = fromMs; ms < toMs; ms += stepMs) {
    states.push(weatherAt(ms, 0x7e3a));
  }
  return states;
}

describe("weatherAt", () => {
  it("is a pure function of time and seed", () => {
    for (let ms = 0; ms < WEATHER_CYCLE_MS * 3; ms += 7919) {
      expect(weatherAt(ms, 11)).toEqual(weatherAt(ms, 11));
    }
    const differs = sweep(0, WEATHER_CYCLE_MS * 4, 5000).some(
      (state, index) => state.rain !== weatherAt(index * 5000, 12).rain,
    );
    expect(differs).toBe(true);
  });

  it("keeps every number in range", () => {
    for (const state of sweep(0, WEATHER_CYCLE_MS * 6, 1000)) {
      expect(state.rain).toBeGreaterThanOrEqual(0);
      expect(state.rain).toBeLessThanOrEqual(1);
      expect(state.overcast).toBeGreaterThanOrEqual(0);
      expect(state.overcast).toBeLessThanOrEqual(1);
      expect(state.wind).toBeGreaterThan(0);
    }
  });

  it("cycles through dry and wet spells rather than raining forever", () => {
    const states = sweep(0, WEATHER_CYCLE_MS * 3, 1000);
    expect(states.some((state) => state.rain === 0)).toBe(true);
    expect(states.some((state) => state.rain > 0.6)).toBe(true);
    expect(states.some((state) => state.overcast < 0.2)).toBe(true);
  });

  it("opens on a fair sky, clouds over, and only then starts to drizzle", () => {
    expect(weatherAt(0).rain).toBe(0);
    expect(weatherAt(0).overcast).toBeLessThan(0.2);
    expect(weatherAt(FAIR_OPENING_MS - 1000).overcast).toBeGreaterThan(0.6);
    expect(weatherAt(FAIR_OPENING_MS - 1000).rain).toBe(0);
    expect(weatherAt(FAIR_OPENING_MS + 15_000).rain).toBeGreaterThan(0.05);
  });

  it("ramps smoothly: nothing jumps between frames, even across a cycle seam", () => {
    let previous = weatherAt(0);
    for (let ms = 50; ms < WEATHER_CYCLE_MS * 3; ms += 50) {
      const next = weatherAt(ms);
      expect(Math.abs(next.rain - previous.rain)).toBeLessThan(0.01);
      expect(Math.abs(next.overcast - previous.overcast)).toBeLessThan(0.01);
      expect(Math.abs(next.wind - previous.wind)).toBeLessThan(0.01);
      previous = next;
    }
  });

  it("storms only in heavy rain under a full sky, and the first spell storms", () => {
    const states = sweep(0, WEATHER_CYCLE_MS * 5, 500);
    const storms = states.filter((state) => state.storm);
    expect(storms.length).toBeGreaterThan(0);
    for (const state of storms) {
      expect(state.rain).toBeGreaterThan(0.7);
      expect(state.overcast).toBeGreaterThan(0.9);
    }
    expect(sweep(0, WEATHER_CYCLE_MS, 500).some((state) => state.storm)).toBe(true);
    // And most of the time is not a storm.
    expect(storms.length / states.length).toBeLessThan(0.3);
  });

  it("treats negative time as the start", () => {
    expect(weatherAt(-500)).toEqual(weatherAt(0));
  });
});

describe("parseWeather", () => {
  it("pins a preset by name, case and space insensitive", () => {
    expect(parseWeather("storm")).toEqual(WEATHER_PRESETS.storm);
    expect(parseWeather(" Clear ")).toEqual(WEATHER_PRESETS.clear);
    expect(WEATHER_PRESETS.storm.storm).toBe(true);
    expect(WEATHER_PRESETS.clear.rain).toBe(0);
  });

  it("leaves the schedule running for anything else", () => {
    expect(parseWeather(null)).toBeUndefined();
    expect(parseWeather("")).toBeUndefined();
    expect(parseWeather("hail")).toBeUndefined();
  });
});

describe("stepWetness", () => {
  it("soaks toward the rain level, never past what that rain can do", () => {
    let wet = 0;
    for (let step = 0; step < 2000; step += 1) {
      wet = stepWetness(wet, 0.3, 50);
    }
    expect(wet).toBeGreaterThan(0.3);
    expect(wet).toBeLessThan(0.4);
  });

  it("soaks faster than it dries", () => {
    let soaked = 0;
    for (let step = 0; step < 200; step += 1) {
      soaked = stepWetness(soaked, 1, 50);
    }
    let dried = 1;
    for (let step = 0; step < 200; step += 1) {
      dried = stepWetness(dried, 0, 50);
    }
    expect(soaked).toBeGreaterThan(0.5);
    expect(1 - dried).toBeLessThan(soaked);
    expect(dried).toBeLessThan(1);
  });

  it("stays in 0..1, and a long frame is clamped", () => {
    expect(stepWetness(1, 1, 50)).toBeLessThanOrEqual(1);
    expect(stepWetness(0, 0, 50)).toBe(0);
    expect(stepWetness(1, 0, 1e9)).toBeGreaterThan(0.9);
  });
});

describe("puddleScale", () => {
  it("swells puddles with wetness, in a few whole steps", () => {
    expect(puddleScale(0)).toBeCloseTo(0.8, 10);
    expect(puddleScale(1)).toBeCloseTo(1.1, 10);
    expect(puddleScale(0.6)).toBeCloseTo(1, 10);
    expect(puddleScale(0.55)).toBe(puddleScale(0.6));
    expect(puddleScale(-3)).toBe(puddleScale(0));
    expect(puddleScale(9)).toBe(puddleScale(1));
  });
});
