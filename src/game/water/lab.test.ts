import { describe, expect, it } from "vitest";

import { validateRegistry } from "../registry-validation";
import { rasterizeSprite } from "../pixel-art";
import { WEATHER_ASSETS } from "../registry/weather";
import { sampleBoltFrames, sampleRainFrames, sampleSplashFrames, sampleWaterScene } from "./lab";

function sizes(frames: ReturnType<typeof sampleBoltFrames>): Set<string> {
  return new Set(
    frames.map((frame) => {
      const raster = rasterizeSprite(frame);
      return `${raster.width}x${raster.height}`;
    }),
  );
}

describe("weather lab frames", () => {
  it("bakes every sampler into same-sized, rasterizable frames", () => {
    for (const frames of [
      sampleWaterScene(13, 3),
      sampleRainFrames(3),
      sampleSplashFrames(3),
      sampleBoltFrames(3),
    ]) {
      expect(frames).toHaveLength(3);
      expect(sizes(frames).size).toBe(1);
    }
  });

  it("shows the time of day in the water", () => {
    const noon = sampleWaterScene(13, 1)[0]?.rows.join("");
    const night = sampleWaterScene(23, 1)[0]?.rows.join("");
    expect(noon).not.toBe(night);
  });

  it("reproduces byte for byte", () => {
    expect(sampleRainFrames(2)).toEqual(sampleRainFrames(2));
    expect(sampleWaterScene(18.6, 2)).toEqual(sampleWaterScene(18.6, 2));
  });

  it("rejects a frame count that is not a positive whole number", () => {
    expect(() => sampleWaterScene(12, 0)).toThrow(/positive integer/);
    expect(() => sampleBoltFrames(1.5)).toThrow(/positive integer/);
  });

  it("registers entries the lab accepts, each with a real palette swap", () => {
    expect(validateRegistry(WEATHER_ASSETS)).toEqual([]);
    for (const entry of WEATHER_ASSETS) {
      expect(entry.variants.length).toBeGreaterThan(1);
      expect(Object.keys(entry.variants[1]?.overrides ?? {}).length).toBeGreaterThan(0);
    }
  });
});
