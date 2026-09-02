import { describe, expect, it } from "vitest";

import { cloudBounds } from "./ink";
import { rasterizeSprite } from "./pixel-art";
import {
  distantPineCloud,
  grassTuftCloud,
  sampleDistantPineFrames,
  sampleGrassFrames,
  sampleTreeFrames,
  treeCloud,
  WIND_PERIOD_MS,
  windOffset,
} from "./vegetation";

describe("the vegetation wind field", () => {
  it("is deterministic, quantized, bounded, and exactly looping", () => {
    for (let time = 0; time <= WIND_PERIOD_MS; time += 137) {
      const sample = windOffset(time, 17, 40, 60, 3);
      expect(Number.isInteger(sample)).toBe(true);
      expect(Math.abs(sample)).toBeLessThanOrEqual(3);
      expect(windOffset(time + WIND_PERIOD_MS, 17, 40, 60, 3)).toBe(sample);
    }
  });

  it("rejects impossible wind strengths", () => {
    expect(() => windOffset(0, 1, 0, 0, -1)).toThrow(/non-negative/);
    expect(() => windOffset(0, 1, 0, 0, Number.NaN)).toThrow(/non-negative/);
  });
});

describe("procedural grass", () => {
  it("keeps every blade rooted while its tips move", () => {
    const frames = [0, 1200, 2400, 3600].map((time) => grassTuftCloud(time, 91));
    expect(
      frames.map((frame) => JSON.stringify(frame)).some((frame) => frame !== JSON.stringify(frames[0])),
    ).toBe(true);
    for (const cloud of frames) {
      expect(cloud.filter((pixel) => pixel.y === 0).length).toBeGreaterThanOrEqual(5);
      expect(cloudBounds(cloud)?.bottom).toBe(0);
    }
  });

  it("samples stable, rasterizable canvases for the asset lab", () => {
    const frames = sampleGrassFrames(7);
    expect(frames).toHaveLength(7);
    expect(frames.map((frame) => rasterizeSprite(frame).width)).toEqual(Array(7).fill(18));
  });
});

describe("procedural trees", () => {
  it("anchors the trunk and bends the crown through more than one silhouette", () => {
    const frames = [0, 800, 1600, 2400, 3200, 4000].map((time) => treeCloud(time, 123));
    expect(new Set(frames.map((frame) => JSON.stringify(frame))).size).toBeGreaterThan(2);
    for (const cloud of frames) {
      expect(cloud.some((pixel) => pixel.x === 0 && pixel.y === 0)).toBe(true);
      const bounds = cloudBounds(cloud);
      expect(bounds?.top).toBeGreaterThanOrEqual(-33);
      expect(bounds?.bottom).toBe(0);
      expect(bounds?.left).toBeGreaterThanOrEqual(-17);
      expect(bounds?.right).toBeLessThanOrEqual(16);
    }
  });

  it("animates the tiny horizon silhouette without moving its foot", () => {
    const frames = Array.from({ length: 8 }, (_, index) =>
      distantPineCloud((index / 8) * WIND_PERIOD_MS, 456),
    );
    expect(new Set(frames.map((frame) => JSON.stringify(frame))).size).toBeGreaterThan(1);
    expect(
      frames.every((cloud) => cloud.some((pixel) => pixel.x === 0 && pixel.y === 0)),
    ).toBe(true);
  });

  it("builds consistent lab filmstrips and rejects empty ones", () => {
    const trees = sampleTreeFrames(8);
    const pines = sampleDistantPineFrames(8);
    expect(new Set(trees.map((frame) => `${frame.rows[0]?.length}x${frame.rows.length}`))).toEqual(
      new Set(["34x34"]),
    );
    expect(new Set(pines.map((frame) => `${frame.rows[0]?.length}x${frame.rows.length}`))).toEqual(
      new Set(["7x6"]),
    );
    expect(() => sampleTreeFrames(0)).toThrow(/positive integer/);
  });
});
