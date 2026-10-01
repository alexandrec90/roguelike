import { describe, expect, it } from "vitest";

import { atmosphereAt } from "./atmosphere";
import type { CameraFrame } from "./camera";
import { hexToRgb } from "./color";
import { ROLL_ROWS } from "./horizon";
import { INK_ALPHA, INK_COLORS } from "./ink";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import { createPuddle, puddleHolds } from "./puddles";
import { rollGroundPixels, type TileTexels } from "./roll-ground";
import { LipWater, puddleOnLip, screenToTexel } from "./roll-water";
import { puddleBody, WET_INK } from "./water/body";
import { skyReflection } from "./water/sky-inks";

const WIDTH = 64;

const FRAME: CameraFrame = {
  groundTop: 40,
  rollHeight: 24,
  footX: 32,
  footY: 100,
  phaseX: 0,
  phaseY: 0,
};

const NOON = skyReflection(atmosphereAt(13));

/** A flat tile, so the only thing on the lip's pixels is the water. */
const PLAIN: TileTexels = {
  width: TILE_WIDTH,
  rgba: new Uint8ClampedArray(TILE_WIDTH * TILE_DEPTH * 4).map((_value, index) => (index % 4 === 3 ? 255 : 90)),
};

/** A puddle straddling the seam: half on the field, half on the lip. */
const STRADDLING = createPuddle({ id: "seam", centerX: FRAME.footX, centerY: FRAME.groundTop, radius: 12, seed: 0x51bd });

describe("screenToTexel", () => {
  it("is the inverse of the field's tile blit: the hero's column is mid-cell, his feet the near edge", () => {
    expect(screenToTexel(FRAME, FRAME.footX, FRAME.footY - 1)).toEqual({ gx: TILE_WIDTH / 2, gy: 0 });
    expect(screenToTexel(FRAME, FRAME.footX - TILE_WIDTH / 2, FRAME.footY - TILE_DEPTH)).toEqual({
      gx: 0,
      gy: TILE_DEPTH - 1,
    });
  });
});

describe("LipWater", () => {
  const water = new LipWater(FRAME, [STRADDLING], NOON);

  it("holds exactly the puddle's still body", () => {
    expect(water.size).toBe(puddleBody(STRADDLING, NOON).length);
  });

  it("says which cells are wet, so a dry cell costs one lookup", () => {
    const { gx, gy } = screenToTexel(FRAME, STRADDLING.centerX, STRADDLING.centerY);
    expect(water.wetCell(Math.floor(gx / TILE_WIDTH), Math.floor(gy / TILE_DEPTH))).toBe(true);
    expect(water.wetCell(40, 40)).toBe(false);
  });

  it("hides the ground under water, but not under the damp ring round it", () => {
    const centre = screenToTexel(FRAME, STRADDLING.centerX, STRADDLING.centerY);
    expect(water.blendInto(centre.gx, centre.gy, new Uint8ClampedArray(4), 0)).toBe(true);
    const damp = puddleBody(STRADDLING, NOON).find((pixel) => pixel.ink === WET_INK);
    expect(damp).toBeDefined();
    const ring = screenToTexel(FRAME, damp?.x ?? 0, damp?.y ?? 0);
    expect(water.blendInto(ring.gx, ring.gy, new Uint8ClampedArray(4), 0)).toBe(false);
    expect(water.blendInto(-500, -500, new Uint8ClampedArray(4), 0)).toBe(false);
  });

  it("puts the field's own water pixels on the lip's first scanline, so a puddle crosses the seam whole", () => {
    // The regression: water was drawn under the lip and nowhere on it, so a
    // puddle vanished the moment it rolled past the field's far edge.
    const rgba = rollGroundPixels(FRAME, WIDTH, { tile: () => PLAIN, tuft: () => null, water }, { r: 0, g: 0, b: 0 });
    const row = FRAME.rollHeight - 1;
    const y = FRAME.groundTop - 1;
    const body = puddleBody(STRADDLING, NOON).filter((pixel) => pixel.y === y);
    expect(body.length).toBeGreaterThan(0);
    for (const pixel of body) {
      const ink = hexToRgb(INK_COLORS[pixel.ink]);
      const a = INK_ALPHA[pixel.ink];
      const expected = [ink.r, ink.g, ink.b].map((channel) => Math.round(channel * a + 90 * (1 - a)));
      const at = (row * WIDTH + pixel.x) * 4;
      const got = [rgba[at] ?? 0, rgba[at + 1] ?? 0, rgba[at + 2] ?? 0];
      got.forEach((channel, index) => expect(Math.abs(channel - (expected[index] ?? 0))).toBeLessThanOrEqual(1));
    }
    expect(puddleHolds(STRADDLING, FRAME.footX, y)).toBe(true);
  });
});

describe("puddleOnLip", () => {
  const seam = (FRAME.footY - FRAME.groundTop) / TILE_DEPTH;

  it("takes puddles from just short of the seam out to the horizon", () => {
    expect(puddleOnLip(FRAME, WIDTH, { x: 0, y: seam })).toBe(true);
    expect(puddleOnLip(FRAME, WIDTH, { x: 0, y: seam - 1 })).toBe(true);
    expect(puddleOnLip(FRAME, WIDTH, { x: 0, y: seam - 3 })).toBe(false);
    expect(puddleOnLip(FRAME, WIDTH, { x: 0, y: seam + ROLL_ROWS })).toBe(true);
    expect(puddleOnLip(FRAME, WIDTH, { x: 0, y: seam + ROLL_ROWS + 3 })).toBe(false);
  });

  it("widens with distance, as the lip's columns fan out", () => {
    const aside = { x: 8, y: seam + 0.5 };
    expect(puddleOnLip(FRAME, WIDTH, aside)).toBe(false);
    expect(puddleOnLip(FRAME, WIDTH, { ...aside, y: seam + 20 })).toBe(true);
  });
});
