import { describe, expect, it } from "vitest";

import { atmosphereAt } from "../atmosphere";
import { INK_ALPHA, type InkId, type PixelCloud } from "../ink";
import { bufferPixel, createBuffer } from "../pixel-buffer";
import { createPuddle, puddleHolds } from "../puddles";
import { createRippleField, spawnRipple } from "../ripples";
import { puddleBody, relativeBody, SHALLOW_INK, WET_INK } from "./body";
import { clipToMask, createMask, fillMask, maskAt } from "./mask";
import { paintBodies, paintSurface } from "./paint";
import { darkenInk, reflectionCloud } from "./reflect";
import {
  inkPair,
  nearestInk,
  pairInk,
  REFLECTION_INKS,
  reflectionKey,
  skyKey,
  skyReflection,
  undoAmbient,
} from "./sky-inks";

const puddle = createPuddle({ id: "t", centerX: 40, centerY: 30, radius: 12, seed: 0x51bd });
const NOON = skyReflection(atmosphereAt(13));
const NIGHT = skyReflection(atmosphereAt(23));

/** A column standing 10 pixels tall, foot at (0, 0). */
const COLUMN: PixelCloud = Array.from({ length: 10 }, (_unused, index) => ({ x: 0, y: -index, ink: "tunic-3" }));

describe("sky inks", () => {
  it("finds the exact ink for a colour that is one", () => {
    expect(nearestInk("#e2f3f5")).toBe("foam");
  });

  it("brackets a colour between two close inks, projected between them", () => {
    const pair = inkPair("#2a6a8a");
    expect(REFLECTION_INKS).toContain(pair.a);
    expect(REFLECTION_INKS).toContain(pair.b);
    expect(pair.t).toBeGreaterThanOrEqual(0);
    expect(pair.t).toBeLessThan(1);
    const pixels = new Set<InkId>();
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        pixels.add(pairInk(pair, x, y));
      }
    }
    expect([...pixels].every((ink) => ink === pair.a || ink === pair.b)).toBe(true);
  });

  it("follows the time of day: noon water is lighter than night water", () => {
    expect(NOON.rows).toHaveLength(NIGHT.rows.length);
    expect(reflectionKey(NOON)).not.toBe(reflectionKey(NIGHT));
    expect(NOON.glint).not.toBe(NIGHT.glint);
  });

  it("pre-divides by the ambient, so the lighting pass lands the water back on the sky", () => {
    expect(undoAmbient("#18244a", "#ffffff")).toBe("#18244a");
    expect(undoAmbient("#18244a", undefined)).toBe("#18244a");
    const lifted = undoAmbient("#18244a", "#4c5a92");
    expect(lifted > "#18244a").toBe(true);
    expect(undoAmbient("#ffffff", "#000000")).toBe("#ffffff");
    const night = atmosphereAt(23);
    expect(reflectionKey(skyReflection(night))).not.toBe(
      reflectionKey(skyReflection({ ...night, ambient: undefined })),
    );
  });

  it("keys the atmosphere coarsely, so a layer re-bakes a few times a minute", () => {
    expect(skyKey(atmosphereAt(13))).toBe(skyKey(atmosphereAt(13.01)));
    expect(skyKey(atmosphereAt(13))).not.toBe(skyKey(atmosphereAt(14)));
  });
});

describe("puddleBody", () => {
  const body = puddleBody(puddle, NOON);

  it("covers every water pixel, plus damp ground outside it", () => {
    const wet = body.filter((pixel) => puddleHolds(puddle, pixel.x, pixel.y));
    expect(wet).toHaveLength(puddle.water.length);
    const ring = body.filter((pixel) => !puddleHolds(puddle, pixel.x, pixel.y));
    expect(ring.length).toBeGreaterThan(0);
    expect(ring.every((pixel) => pixel.ink === WET_INK)).toBe(true);
    expect(INK_ALPHA[WET_INK]).toBeLessThan(1);
  });

  it("darkens the far lip and leaves the near edge sheer", () => {
    const water = body.filter((pixel) => puddleHolds(puddle, pixel.x, pixel.y));
    const lip = water.filter((pixel) => pixel.ink === NOON.lip);
    const shallow = water.filter((pixel) => pixel.ink === SHALLOW_INK);
    expect(lip.length).toBeGreaterThan(0);
    expect(shallow.length).toBeGreaterThan(0);
    expect(INK_ALPHA[SHALLOW_INK]).toBeLessThan(1);
    const mean = (cloud: PixelCloud): number => cloud.reduce((sum, pixel) => sum + pixel.y, 0) / cloud.length;
    expect(mean(lip)).toBeLessThan(mean(shallow));
  });

  it("is still: the same sky makes the same body", () => {
    expect(puddleBody(puddle, NOON)).toEqual(body);
    expect(puddleBody(puddle, NIGHT)).not.toEqual(body);
  });

  it("is the body painted afresh even when it comes from the cache of a puddle a step away", () => {
    // Bodies are kept about their centres, per sky, by where the centre falls
    // on the 4x4 dither. A step moves a puddle 12 pixels forward or 16 across,
    // so the kept body is reused - and must be exactly what painting it would give.
    const sky = skyReflection(atmosphereAt(13));
    const moved = (dx: number, dy: number): typeof puddle =>
      createPuddle({ id: "t", centerX: 40 + dx, centerY: 30 + dy, radius: 12, seed: 0x51bd });
    puddleBody(moved(0, 0), sky);
    for (const [dx, dy] of [
      [0, 12],
      [16, 0],
      [-16, 24],
      [1, 0],
      [0, 3],
    ] as const) {
      const fresh = skyReflection(atmosphereAt(13));
      expect(puddleBody(moved(dx, dy), sky)).toEqual(puddleBody(moved(dx, dy), fresh));
    }
  });

  it("gives the same pixels about the centre as it does on the screen", () => {
    const relative = relativeBody(puddle, NOON);
    expect(relative.map((pixel) => ({ ...pixel, x: pixel.x + 40, y: pixel.y + 30 }))).toEqual(body);
  });
});

describe("darkenInk", () => {
  it("steps a family ink down its own ramp and stops at the bottom", () => {
    expect(darkenInk("tunic-3")).toBe("tunic-1");
    expect(darkenInk("fire-6", 1)).toBe("fire-5");
    expect(darkenInk("grass-0")).toBe("grass-0");
  });

  it("maps the first palette's inks onto a darker family ink", () => {
    expect(darkenInk("bone")).toBe("frost-3");
    expect(darkenInk("void")).toBe("void");
  });
});

describe("reflectionCloud", () => {
  it("hangs below the foot in darker inks of the same hue", () => {
    const image = reflectionCloud(COLUMN, 20, 20, 0);
    expect(image.length).toBeGreaterThan(0);
    expect(image.every((pixel) => pixel.y > 20)).toBe(true);
    expect(image.every((pixel) => pixel.ink === "tunic-1")).toBe(true);
  });

  it("keeps an emissive thing brighter than an ordinary one", () => {
    const glow = reflectionCloud(COLUMN, 20, 20, 0, { glow: true });
    expect(glow.every((pixel) => pixel.ink === "tunic-2")).toBe(true);
  });

  it("fades toward its far end and ripples harder in the rain", () => {
    const tall: PixelCloud = Array.from({ length: 30 }, (_unused, index) => ({ x: 0, y: -index, ink: "bone" }));
    const image = reflectionCloud(tall, 0, 0, 0);
    expect(image.length).toBeLessThan(30);
    const spread = (rain: number): number => {
      const xs = new Set<number>();
      for (let ms = 0; ms < 2000; ms += 100) {
        for (const pixel of reflectionCloud(COLUMN, 0, 0, ms, { rain })) {
          xs.add(pixel.x);
        }
      }
      return xs.size;
    };
    expect(spread(1)).toBeGreaterThan(spread(0));
  });
});

describe("the water mask", () => {
  const mask = createMask(80, 60, 8);
  fillMask(mask, [puddle]);

  it("agrees with the puddle it was filled from, margin included", () => {
    for (const pixel of puddle.water) {
      expect(maskAt(mask, pixel.x, pixel.y)).toBe(1);
    }
    expect(maskAt(mask, 0, 0)).toBe(0);
    expect(maskAt(mask, -100, -100)).toBe(0);
  });

  it("clips a cloud to the water", () => {
    const cloud: PixelCloud = [
      { x: puddle.centerX, y: puddle.centerY, ink: "bone" },
      { x: 2, y: 2, ink: "bone" },
    ];
    expect(clipToMask(mask, cloud)).toEqual([cloud[0]]);
  });
});

describe("painting the water", () => {
  const mask = createMask(80, 60, 8);
  fillMask(mask, [puddle]);
  const scene = { puddles: [puddle], mask, sky: NOON };

  it("bakes bodies into the buffer at the margin offset", () => {
    const buffer = createBuffer(mask.width, mask.height);
    paintBodies(buffer, scene);
    expect(bufferPixel(buffer, puddle.centerX + 8, puddle.centerY + 8)[3]).toBe(255);
    expect(bufferPixel(buffer, 0, 0)[3]).toBe(0);
  });

  it("paints rings and reflections only over water, and a strike over all of it", () => {
    const ripples = createRippleField(4);
    spawnRipple(ripples, puddle.centerX, puddle.centerY);
    const buffer = createBuffer(mask.width, mask.height);
    paintSurface(buffer, scene, ripples, [{ cloud: COLUMN, foot: { x: puddle.centerX, y: puddle.centerY - 6 } }], {
      elapsedMs: 0,
      rain: 0.5,
      strike: 0,
    });
    let painted = 0;
    for (let y = 0; y < mask.height; y += 1) {
      for (let x = 0; x < mask.width; x += 1) {
        if (bufferPixel(buffer, x, y)[3] > 0) {
          painted += 1;
          expect(maskAt(mask, x - 8, y - 8)).toBe(1);
        }
      }
    }
    expect(painted).toBeGreaterThan(0);

    const struck = createBuffer(mask.width, mask.height);
    paintSurface(struck, scene, createRippleField(1), [], { elapsedMs: 0, rain: 0, strike: 1 });
    let lit = 0;
    for (const pixel of puddle.water) {
      lit += bufferPixel(struck, pixel.x + 8, pixel.y + 8)[3] > 0 ? 1 : 0;
    }
    expect(lit).toBe(puddle.water.length);
  });
});
