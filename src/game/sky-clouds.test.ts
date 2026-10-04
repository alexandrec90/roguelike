import { describe, expect, it } from "vitest";

import { atmosphereAt } from "./atmosphere";
import type { Rgb } from "./color";
import { PANORAMA_WIDTH } from "./panorama";
import {
  CLOUD_DECKS,
  cloudTone,
  cloudTones,
  deckClouds,
  paintCloudDecks,
  puffSurface,
  type CloudDeck,
  type CloudPaint,
  type CloudTones,
  type Puff,
  type PuffSurface,
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

/** One deck painted round the whole panorama, at an overcast. */
function wholeDeck(deck: CloudDeck, overcast: number): Map<string, { rgb: Rgb; alpha: number }> {
  const pixels = new Map<string, { rgb: Rgb; alpha: number }>();
  paintCloudDecks(paint({ width: PANORAMA_WIDTH, overcast }), (x, y, rgb, alpha) => pixels.set(`${x},${y}`, { rgb, alpha }), [
    deck,
  ]);
  return pixels;
}

/** Share of panorama columns with any cloud in them. */
function cover(deck: CloudDeck, overcast: number): number {
  const columns = new Set([...wholeDeck(deck, overcast).keys()].map((key) => key.split(",")[0]));
  return columns.size / PANORAMA_WIDTH;
}

describe("deckClouds", () => {
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
      Math.max(...deckClouds(LOW, overcast).flatMap((cloud) => cloud.puffs.map((puff) => puff.radius)));
    expect(tallest(1)).toBeGreaterThan(tallest(0));
  });

  it("swells the clouds it has as the sky clouds over, so none pops in whole", () => {
    // The regression this guards: a cloud that appears at full size the
    // moment a threshold is crossed. Every cloud is first seen small.
    const before = new Map(deckClouds(LOW, 0.3).map((cloud) => [cloud.x, cloud.halfWidth]));
    const after = deckClouds(LOW, 0.32);
    for (const cloud of after) {
      const was = before.get(cloud.x);
      if (was === undefined) {
        expect(cloud.halfWidth).toBeLessThan(LOW.width / 4);
      } else {
        expect(cloud.halfWidth).toBeGreaterThanOrEqual(was);
      }
    }
  });

  it("builds every cloud from several puffs, biggest toward the middle", () => {
    for (const cloud of deckClouds(LOW, 0.2)) {
      expect(cloud.puffs.length).toBeGreaterThanOrEqual(3);
      const radii = cloud.puffs.map((puff) => puff.radius);
      const ends = Math.max(radii[0] as number, radii[radii.length - 1] as number);
      expect(Math.max(...radii)).toBeGreaterThanOrEqual(ends);
    }
  });

  it("never stands taller than its deck allows, nor below its base but for one row of sag", () => {
    for (const deck of CLOUD_DECKS) {
      const base = Math.round(16 * deck.base);
      const rows = [...wholeDeck(deck, 0).keys()].map((key) => Number(key.split(",")[1]));
      expect(Math.min(...rows)).toBeGreaterThanOrEqual(base - Math.ceil(deck.height));
      expect(Math.max(...rows)).toBeLessThanOrEqual(base + 1);
    }
  });
});

describe("puffSurface", () => {
  const PUFFS: Puff[] = [
    { x: -4, lift: 1, radius: 4 },
    { x: 4, lift: 2, radius: 6 },
  ];

  it("is undefined outside every puff, and below the flat base", () => {
    expect(puffSurface(PUFFS, -20, 1)).toBeUndefined();
    expect(puffSurface(PUFFS, 0, 20)).toBeUndefined();
    expect(puffSurface(PUFFS, 4, -0.5)).toBeUndefined();
  });

  it("points up at a crown and out at a flank", () => {
    const crown = puffSurface(PUFFS, 4, 5) as PuffSurface;
    expect(crown.ny).toBeGreaterThan(0.5);
    expect(Math.abs(crown.nx)).toBeLessThan(0.1);
    const flank = puffSurface(PUFFS, 9.5, 2) as PuffSurface;
    expect(flank.nx).toBeGreaterThan(0.8);
  });

  it("shows the puff a point is deepest in where two overlap", () => {
    // On the small puff's right shoulder and the big one's left flank at once:
    // it is deeper in the big puff, so that flank shows - the crease.
    const seam = puffSurface(PUFFS, -1, 2) as PuffSurface;
    expect(seam.nx).toBeLessThan(0);
  });
});

describe("cloudTone", () => {
  const at = (nx: number, ny: number, height = 3, sunSide = 1) => ({ nx, ny, height, sunSide });

  it("lights the crown, shades the base, and fills the body between", () => {
    expect(cloudTone(TONES, at(0, 1, 5), 0, 0)).toBe(TONES.lit);
    expect(cloudTone(TONES, at(0, -0.3, 0), 0, 0)).toBe(TONES.shade);
    expect(cloudTone(TONES, at(0, 0, 3), 0, 0)).toBe(TONES.body);
  });

  it("catches the light on the flank facing the sun, whichever side it is on", () => {
    expect(cloudTone(TONES, at(0.8, 0.3, 3, 1), 0, 0)).toBe(TONES.lit);
    expect(cloudTone(TONES, at(-0.8, 0.3, 3, 1), 0, 0)).toBe(TONES.shade);
    expect(cloudTone(TONES, at(-0.8, 0.3, 3, -1), 0, 0)).toBe(TONES.lit);
  });

  it("does not shade the base row of a puff whose crown sits on it", () => {
    expect(cloudTone(TONES, at(0, 0.9, 0), 0, 0)).toBe(TONES.lit);
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

  it("slides across the panorama's seam without a cut, so a full turn comes back to the same cloud", () => {
    // Turning by one pixel shifts every cloud pixel by one, at the wrap as
    // anywhere else: a cloud straddling it is drawn whole, from both ends.
    // (Shape only: the dither is locked to the screen, so a seam's tone may move.)
    const near = (offset: number): Set<string> => new Set(painted(paint({ width: 120, overcast: 0.7, offset })).keys());
    const before = near(PANORAMA_WIDTH - 60);
    const after = near(PANORAMA_WIDTH - 59);
    expect(before.size).toBeGreaterThan(0);
    for (const key of after) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      if (x < 119) {
        expect(before.has(`${x + 1},${y}`)).toBe(true);
      }
    }
    expect(painted(paint({ overcast: 0.4, offset: PANORAMA_WIDTH + 13 }))).toEqual(
      painted(paint({ overcast: 0.4, offset: 13 })),
    );
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
