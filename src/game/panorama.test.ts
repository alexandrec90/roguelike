import { describe, expect, it } from "vitest";

import {
  bearingOffset,
  landmarkX,
  panoramaColumn,
  panoramaRidge,
  PANORAMA_WIDTH,
  wrapPanorama,
} from "./panorama";
import { DEFAULT_STRAFE_RADIUS } from "./planet";

const TAU = Math.PI * 2;

describe("wrapPanorama", () => {
  it("folds both ways into one turn", () => {
    expect(wrapPanorama(0)).toBe(0);
    expect(wrapPanorama(PANORAMA_WIDTH)).toBe(0);
    expect(wrapPanorama(-1)).toBe(PANORAMA_WIDTH - 1);
  });
});

describe("bearingOffset", () => {
  it("is a whole number of pixels, so nothing on the horizon rounds separately", () => {
    for (const turn of [0, 0.3, 1.1, 4.7]) {
      expect(Number.isInteger(bearingOffset(turn))).toBe(true);
    }
  });

  it("carries a full turn exactly once round the panorama", () => {
    expect(bearingOffset(0)).toBe(0);
    expect(bearingOffset(TAU)).toBe(0);
    expect(bearingOffset(TAU / 4)).toBe(PANORAMA_WIDTH / 4);
    expect(bearingOffset(TAU / 2)).toBe(PANORAMA_WIDTH / 2);
  });

  it("keeps the horizon under a pixel per step at the shipped radius", () => {
    // This used to assert the opposite - about eleven pixels a step, "motion
    // rather than drift" - and it was right for the radius of the day. The
    // default is now 512 precisely so a strafe moves nothing perceptibly, the
    // sky included: see DEFAULT_STRAFE_RADIUS for why the ground forced that.
    // Asserted rather than dropped, so lowering the radius without reading that
    // note fails here as well as in `map-drift.test.ts`.
    expect(bearingOffset(1 / DEFAULT_STRAFE_RADIUS)).toBeLessThan(1);
  });

  it("still swings the sky readably when the knob is turned down", () => {
    // The mechanism is intact and only its setting changed - which is the half
    // of the old assertion worth keeping, and the half that would otherwise be
    // silently lost if `bearingOffset` were ever broken.
    const step = bearingOffset(1 / 19);
    expect(step).toBeGreaterThan(4);
    expect(step).toBeLessThan(24);
  });
});

describe("landmarkX", () => {
  it("moves a landmark left as the hero turns right", () => {
    // Ground and sky must sweep the same way, or strafing reads as a glitch.
    const still = landmarkX(400, bearingOffset(0));
    const turned = landmarkX(400, bearingOffset(0.2));
    expect(turned).toBeLessThan(still);
  });

  it("is signed and centred, so behind you reads as far off the edge", () => {
    expect(landmarkX(0, 0)).toBe(0);
    expect(landmarkX(PANORAMA_WIDTH - 10, 0)).toBe(-10);
    expect(Math.abs(landmarkX(PANORAMA_WIDTH / 2 + 4, 0))).toBeGreaterThan(320);
  });

  it("brings a landmark back to where it started after one lap", () => {
    expect(landmarkX(200, bearingOffset(TAU))).toBe(landmarkX(200, bearingOffset(0)));
  });
});

describe("panoramaColumn", () => {
  it("agrees with landmarkX about where a thing is", () => {
    // The ridge is sampled forward and landmarks are placed backward; if the
    // two ever disagree a pine drifts off the hill it is standing on.
    const offset = bearingOffset(1.3);
    const at = 700;
    const screenX = landmarkX(at, offset);
    expect(panoramaColumn(screenX, offset)).toBe(at);
  });
});

describe("panoramaRidge", () => {
  it("is one turn wide", () => {
    expect(panoramaRidge({ seed: 7 })).toHaveLength(PANORAMA_WIDTH);
  });

  it("closes on itself, so the loop has no cliff in it", () => {
    // Generating open noise looks identical on screen and puts a step at one
    // bearing, once a lap. Only a test finds it.
    const profile = panoramaRidge({ seed: 7, base: 3, amplitude: 3, wavelength: 55 });
    const first = profile[0] ?? 0;
    const last = profile[PANORAMA_WIDTH - 1] ?? 0;
    expect(Math.abs(last - first)).toBeLessThanOrEqual(1);
  });

  it("never rises higher than it was told it could", () => {
    for (const height of panoramaRidge({ seed: 21, maxHeight: 4 })) {
      expect(height).toBeLessThanOrEqual(4);
      expect(height).toBeGreaterThanOrEqual(0);
    }
  });
});
