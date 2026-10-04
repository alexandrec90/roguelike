import { describe, expect, it } from "vitest";

import { DEFAULT_SCENE_OPTIONS, parseRenderPath, parseSkyStyle, parseWeather, readSceneOptions } from "./scene-options";
import { MAX_FRAME_MS, WorldClock } from "./world-clock";

describe("the world clock", () => {
  it("advances play time by clamped deltas", () => {
    const clock = new WorldClock(undefined, 60_000, 12);
    expect(clock.tick(16)).toBe(16);
    expect(clock.tick(5000)).toBe(MAX_FRAME_MS);
    expect(clock.elapsedMs).toBe(16 + MAX_FRAME_MS);
  });

  it("holds play time still through a hit stop, and shakes meanwhile", () => {
    const clock = new WorldClock(undefined, 60_000, 12);
    clock.sink.hitStop(30);
    clock.sink.shake(3, 200);
    expect(clock.tick(16)).toBe(0);
    expect(clock.tick(16)).toBe(2);
    expect(clock.elapsedMs).toBe(2);
    const offsets = Array.from({ length: 8 }, () => {
      clock.tick(32);
      return clock.shake();
    });
    expect(offsets.some((offset) => offset.x !== 0 || offset.y !== 0)).toBe(true);
  });

  it("runs the day from its start hour, or stays pinned", () => {
    const running = new WorldClock(undefined, 24_000, 6);
    running.tick(40);
    expect(running.hours()).toBeCloseTo(6.04, 6);
    const pinned = new WorldClock(21, 24_000, 6);
    pinned.tick(40);
    expect(pinned.hours()).toBe(21);
    expect(pinned.atmosphere(0).hours).toBe(21);
  });
});

describe("scene options", () => {
  it("reads every knob from the query", () => {
    const options = readSceneOptions(new URLSearchParams("time=20:30&day=90&weather=Storm&radius=64"));
    expect(options.pinnedHours).toBe(20.5);
    expect(options.dayMs).toBe(90_000);
    expect(options.weather).toBe("storm");
    expect(options.radius).toBe(64);
  });

  it("falls back on an empty or unreadable query", () => {
    expect(readSceneOptions(new URLSearchParams(""))).toEqual(DEFAULT_SCENE_OPTIONS);
    expect(parseWeather("sleet")).toBeUndefined();
    expect(parseWeather(null)).toBeUndefined();
  });

  it("draws on the GPU unless asked for the CPU passes by name", () => {
    expect(readSceneOptions(new URLSearchParams("render=CPU")).render).toBe("cpu");
    expect(parseRenderPath(" cpu ")).toBe("cpu");
    expect(parseRenderPath("gpu")).toBe("gpu");
    expect(parseRenderPath("software")).toBe("gpu");
    expect(parseRenderPath(null)).toBe("gpu");
  });

  it("draws the pixel sky unless asked for the screen-resolution one by name", () => {
    expect(readSceneOptions(new URLSearchParams("sky=HD")).sky).toBe("hd");
    expect(parseSkyStyle(" hd ")).toBe("hd");
    expect(parseSkyStyle("pixel")).toBe("pixel");
    expect(parseSkyStyle("4k")).toBe("pixel");
    expect(parseSkyStyle(null)).toBe("pixel");
  });
});
