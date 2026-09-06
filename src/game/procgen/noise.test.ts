import { describe, expect, it } from "vitest";

import { curlFlow, fbm2, fbm3, signedNoise, valueNoise2, valueNoise3 } from "./noise";

describe("value noise", () => {
  it("is deterministic and bounded to 0..1", () => {
    for (let index = 0; index < 40; index += 1) {
      const x = index * 0.37 - 6;
      const y = index * -0.21 + 3;
      const sample = valueNoise2(x, y, 0x1234);
      expect(sample).toBeGreaterThanOrEqual(0);
      expect(sample).toBeLessThanOrEqual(1);
      expect(valueNoise2(x, y, 0x1234)).toBe(sample);
    }
  });

  it("is continuous: neighbours differ far less than a hash would", () => {
    let worst = 0;
    for (let step = 0; step < 60; step += 1) {
      const x = step * 0.05;
      worst = Math.max(worst, Math.abs(valueNoise2(x, 2, 7) - valueNoise2(x + 0.05, 2, 7)));
    }
    expect(worst).toBeLessThan(0.3);
  });

  it("reproduces the 2D field on integer layers of the 3D one", () => {
    expect(valueNoise3(1.5, -2.5, 0, 99)).toBeCloseTo(valueNoise2(1.5, -2.5, 99), 10);
  });

  it("changes with the seed", () => {
    expect(valueNoise2(3.3, 1.1, 1)).not.toBe(valueNoise2(3.3, 1.1, 2));
  });
});

describe("fBm", () => {
  it("stays in 0..1 at every octave count", () => {
    for (const octaves of [1, 2, 3, 5]) {
      const sample = fbm3(2.5, -1.5, 0.75, 0xabc, { octaves });
      expect(sample).toBeGreaterThanOrEqual(0);
      expect(sample).toBeLessThanOrEqual(1);
    }
  });

  it("adds detail: more octaves means more variation over a short walk", () => {
    const variation = (octaves: number): number => {
      let total = 0;
      for (let step = 0; step < 50; step += 1) {
        total += Math.abs(fbm2(step * 0.1, 0, 5, { octaves }) - fbm2((step + 1) * 0.1, 0, 5, { octaves }));
      }
      return total;
    };
    expect(variation(4)).toBeGreaterThan(variation(1));
  });

  it("treats a zero or negative octave count as one octave rather than dividing by zero", () => {
    expect(fbm2(1, 1, 3, { octaves: 0 })).toBe(fbm2(1, 1, 3, { octaves: 1 }));
  });

  it("centres the signed form on zero", () => {
    let sum = 0;
    for (let step = 0; step < 200; step += 1) {
      sum += signedNoise(step * 0.31, step * 0.17, 0, 0x5150);
    }
    expect(Math.abs(sum / 200)).toBeLessThan(0.2);
  });
});

describe("the curl flow field", () => {
  it("is divergence-free to the accuracy of the difference that built it", () => {
    const epsilon = 0.5;
    const divergence = (x: number, y: number): number => {
      const east = curlFlow(x + epsilon, y, 0, 42, epsilon).x;
      const west = curlFlow(x - epsilon, y, 0, 42, epsilon).x;
      const south = curlFlow(x, y + epsilon, 0, 42, epsilon).y;
      const north = curlFlow(x, y - epsilon, 0, 42, epsilon).y;
      return Math.abs((east - west) / (2 * epsilon) + (south - north) / (2 * epsilon));
    };
    // A gradient field would show divergence of the same order as its own
    // magnitude here; the curl of a potential cancels to near nothing.
    expect(divergence(3, -2)).toBeLessThan(0.05);
  });

  it("is deterministic and moves with time", () => {
    const now = curlFlow(1, 1, 0, 8);
    expect(curlFlow(1, 1, 0, 8)).toEqual(now);
    expect(curlFlow(1, 1, 4, 8)).not.toEqual(now);
  });
});
