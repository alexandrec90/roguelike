import { describe, expect, it } from "vitest";

import type { CameraFrame } from "./camera";
import { buildMap, tunnelCentre } from "./cave-map";
import { caveClouds, caveLights, caveSchedule, cutAway, renderCave, type CaveView } from "./cave-march";
import { horizonLayout } from "./horizon";
import type { PixelCloud } from "./ink";
import { createBuffer } from "./pixel-buffer";
import { fromLocal } from "./planet";

const LAYOUT = horizonLayout(180, 0.22);
const FRAME: CameraFrame = {
  groundTop: LAYOUT.groundTop,
  rollHeight: LAYOUT.rollHeight,
  footX: 160,
  footY: 120,
  phaseX: 0,
  phaseY: 0,
};
const ENTRY = { x: 128, y: 128, turn: 0 };
const MAP = buildMap(6607);

function viewAt(along: number): CaveView {
  const at = fromLocal(ENTRY, { x: Math.round(tunnelCentre(MAP.seed, along)), y: along });
  return { frame: FRAME, pose: { ...at, turn: 0 }, entry: ENTRY, map: MAP, elapsedMs: 0 };
}

function inkAt(cloud: PixelCloud, x: number, y: number): string | undefined {
  return cloud.find((pixel) => pixel.x === x && pixel.y === y)?.ink;
}

describe("caveSchedule", () => {
  it("marches near to far, past the field and over the horizon", () => {
    const steps = caveSchedule(FRAME, 180);
    for (let k = 1; k < steps.length; k += 1) {
      expect(steps[k]!.y).toBeGreaterThan(steps[k - 1]!.y);
    }
    expect(steps.some((step) => step.ground > 180)).toBe(true);
    expect(steps.some((step) => step.scale < 1 && !Number.isFinite(step.clipY))).toBe(true);
    expect(steps.some((step) => Number.isFinite(step.clipY))).toBe(true);
  });
});

describe("cutAway", () => {
  it("leaves rock level with the hero and beyond at full height", () => {
    expect(cutAway(3, 0)).toBe(3);
    expect(cutAway(3, 4)).toBe(3);
    expect(cutAway(0, -2)).toBe(0);
  });

  it("eases rock nearer the camera down to a ledge, without a jump", () => {
    expect(cutAway(3, -0.1)).toBeLessThan(3);
    expect(cutAway(3, -0.1)).toBeGreaterThan(cutAway(3, -0.4));
    expect(cutAway(3, -5)).toBeGreaterThan(0);
    expect(cutAway(3, -5)).toBeLessThan(0.5);
  });
});

describe("the march", () => {
  it("draws the floor under the hero and lets nothing stand over him", () => {
    const { back, front } = caveClouds(viewAt(20), 320, 180);
    expect(inkAt(back, 160, 122)).toMatch(/^stone-/);
    for (let y = 95; y < 120; y += 1) {
      expect(inkAt(front, 160, y)).toBeUndefined();
    }
  });

  it("carries the floor onto the horizon's lip, deep in a straight-enough tunnel", () => {
    const { back } = caveClouds(viewAt(0), 320, 180);
    const lip = back.filter((pixel) => pixel.y >= LAYOUT.horizonY && pixel.y < LAYOUT.groundTop);
    expect(lip.length).toBeGreaterThan(0);
  });

  it("shows the end: from near it the back wall stands on the field", () => {
    const { back } = caveClouds(viewAt(MAP.length - 2), 320, 180);
    const faces = back.filter((pixel) => pixel.y > LAYOUT.groundTop && pixel.y < 110 && pixel.ink === "stone-4");
    expect(faces.length).toBeGreaterThan(5);
  });

  it("draws the same picture into buffers as into clouds", () => {
    const view = viewAt(30);
    const picture = { back: createBuffer(320, 180), front: createBuffer(320, 180), depth: new Float32Array(320 * 180) };
    renderCave(view, picture);
    const { back } = caveClouds(view, 320, 180);
    const painted = picture.back.data.filter((_value, index) => index % 4 === 3 && picture.back.data[index] === 255).length;
    expect(painted).toBe(new Set(back.map((pixel) => `${pixel.x},${pixel.y}`)).size);
  });

  it("is a pure function of the view", () => {
    expect(caveClouds(viewAt(12), 320, 180)).toEqual(caveClouds(viewAt(12), 320, 180));
  });
});

describe("caveLights", () => {
  it("lights the way out from the mouth, and the torches in sight", () => {
    const lights = caveLights(viewAt(0));
    expect(lights.length).toBeGreaterThan(1);
    for (const light of lights) {
      expect(light.intensity).toBeGreaterThan(0);
      expect(light.radius).toBeGreaterThan(0);
    }
  });
});
