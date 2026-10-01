import { describe, expect, it } from "vitest";

import { atmosphereAt } from "./atmosphere";
import type { Rgb } from "./color";
import { PANORAMA_WIDTH } from "./panorama";
import {
  CLOUD_DECKS,
  cloudThickness,
  cloudTone,
  cloudTones,
  paintCloudDecks,
  type CloudDeck,
  type CloudPaint,
  type CloudTones,
} from "./sky-clouds";

const LOW = CLOUD_DECKS[CLOUD_DECKS.length - 1] as CloudDeck;

const TONES: CloudTones = {
  shade: { r: 1, g: 1, b: 1 },
  body: { r: 2, g: 2, b: 2 },
  lit: { r: 3, g: 3, b: 3 },
};

function paint(overrides: Partial<CloudPaint> = {}): CloudPaint {
  return { width: 320, skyHeight: 16, offset: 0, drift: 0, overcast: 0, sunSide: 1, tones: TONES, ...overrides };
}

function painted(settings: CloudPaint): Map<string, { rgb: Rgb; alpha: number }> {
  const pixels = new Map<string, { rgb: Rgb; alpha: number }>();
  paintCloudDecks(settings, (x, y, rgb, alpha) => pixels.set(`${x},${y}`, { rgb, alpha }));
  return pixels;
}

function cover(deck: CloudDeck, overcast: number): number {
  let cloudy = 0;
  for (let column = 0; column < PANORAMA_WIDTH; column += 1) {
    cloudy += cloudThickness(deck, column, overcast) > 0 ? 1 : 0;
  }
  return cloudy / PANORAMA_WIDTH;
}

describe("cloudThickness", () => {
  it("leaves clear sky between clouds on a fair day", () => {
    const fair = cover(LOW, 0);
    expect(fair).toBeGreaterThan(0.05);
    expect(fair).toBeLessThan(0.7);
  });

  it("closes into a sheet as the sky clouds over, and stands taller", () => {
    expect(cover(LOW, 1)).toBeGreaterThan(cover(LOW, 0.5));
    expect(cover(LOW, 0.5)).toBeGreaterThan(cover(LOW, 0));
    expect(cover(LOW, 1)).toBeGreaterThan(0.85);
    const tallest = (overcast: number): number =>
      Math.max(...Array.from({ length: PANORAMA_WIDTH }, (_unused, column) => cloudThickness(LOW, column, overcast)));
    expect(tallest(1)).toBeGreaterThan(tallest(0));
  });

  it("closes on itself round the panorama, so a full turn has no seam", () => {
    for (const deck of CLOUD_DECKS) {
      expect(cloudThickness(deck, PANORAMA_WIDTH, 0.4)).toBe(cloudThickness(deck, 0, 0.4));
      expect(cloudThickness(deck, -1, 0.4)).toBe(cloudThickness(deck, PANORAMA_WIDTH - 1, 0.4));
    }
  });

  it("never stands taller than its deck allows", () => {
    for (let column = 0; column < PANORAMA_WIDTH; column += 7) {
      expect(cloudThickness(LOW, column, 1)).toBeLessThanOrEqual(LOW.height * 1.8 * 1.3 + 1e-9);
    }
  });
});

describe("cloudTone", () => {
  it("lights the crown, shades the base, and fills the body between", () => {
    expect(cloudTone(TONES, { depth: 0.2, thickness: 5, sunward: false }, 0, 0)).toBe(TONES.lit);
    expect(cloudTone(TONES, { depth: 4.6, thickness: 5, sunward: false }, 0, 0)).toBe(TONES.shade);
    expect(cloudTone(TONES, { depth: 3, thickness: 5, sunward: false }, 0, 0)).toBe(TONES.body);
  });

  it("catches the light on the slope facing the sun", () => {
    expect(cloudTone(TONES, { depth: 2.2, thickness: 6, sunward: true }, 0, 0)).toBe(TONES.lit);
    expect(cloudTone(TONES, { depth: 2.2, thickness: 6, sunward: false }, 0, 0)).toBe(TONES.body);
  });

  it("does not shade a wisp too thin to have a base", () => {
    expect(cloudTone(TONES, { depth: 0.5, thickness: 1, sunward: false }, 0, 0)).toBe(TONES.lit);
  });
});

describe("paintCloudDecks", () => {
  it("paints only inside the sky band, in the three tones", () => {
    const pixels = painted(paint({ overcast: 0.6 }));
    expect(pixels.size).toBeGreaterThan(0);
    for (const [key, pixel] of pixels) {
      const [x, y] = key.split(",").map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(320);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(16);
      expect([TONES.shade, TONES.body, TONES.lit]).toContain(pixel.rgb);
      expect(pixel.alpha).toBeGreaterThan(0);
      expect(pixel.alpha).toBeLessThanOrEqual(1);
    }
  });

  it("draws a cloud as a solid shape with a flat base, not a scatter of dots", () => {
    // The regression: noise thresholded per pixel left lone cloud pixels with
    // clear sky all round them. A column of cloud here is contiguous.
    const pixels = painted(paint({ overcast: 0.3 }));
    for (const key of pixels.keys()) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      const neighbours = [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`];
      expect(neighbours.some((neighbour) => pixels.has(neighbour))).toBe(true);
    }
  });

  it("turns with the bearing and drifts on its own, a high deck slower than a low one", () => {
    const here = painted(paint({ overcast: 0.4 }));
    const turned = painted(paint({ overcast: 0.4, offset: 37 }));
    expect([...turned.keys()]).not.toEqual([...here.keys()]);
    const deckOnly = (deck: CloudDeck, settings: CloudPaint): string[] => {
      const keys: string[] = [];
      paintCloudDecks(settings, (x, y) => keys.push(`${x},${y}`), [deck]);
      return keys;
    };
    const high = CLOUD_DECKS[0] as CloudDeck;
    expect(high.drift).toBeLessThan(LOW.drift);
    // Drifted 0.9: the low deck has moved a whole pixel, the high one not yet.
    const still = paint({ overcast: 0.6 });
    const drifted = paint({ overcast: 0.6, drift: 0.9 });
    expect(deckOnly(high, drifted)).toEqual(deckOnly(high, still));
    expect(deckOnly(LOW, drifted)).not.toEqual(deckOnly(LOW, still));
  });

  it("is deterministic", () => {
    expect(painted(paint({ overcast: 0.5, offset: 11, drift: 7 }))).toEqual(
      painted(paint({ overcast: 0.5, offset: 11, drift: 7 })),
    );
  });
});

describe("cloudTones", () => {
  it("is brightest on top, and greyer under an overcast sky", () => {
    const fair = cloudTones({ ...atmosphereAt(13), overcast: 0 });
    const grey = cloudTones({ ...atmosphereAt(13), overcast: 1 });
    const sum = (rgb: Rgb): number => rgb.r + rgb.g + rgb.b;
    expect(sum(fair.lit)).toBeGreaterThan(sum(fair.body));
    expect(sum(fair.body)).toBeGreaterThan(sum(fair.shade));
    const spread = (rgb: Rgb): number => Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);
    expect(spread(grey.lit)).toBeLessThanOrEqual(spread(fair.lit));
  });
});
