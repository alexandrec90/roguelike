import { describe, expect, it } from "vitest";

import type { CameraFrame } from "./camera";
import { createGrid, setGrid } from "./ground/ink-grid";
import { HORIZON_SCALE, ROLL_ROWS } from "./horizon";
import { TILE_DEPTH, TILE_WIDTH, WALL_RISE } from "./projection";
import type { TileTexels } from "./roll-ground";
import { faceTexels, HORIZON_SINK, paintRollRock, rockSamples, type RockAt, type RockLook } from "./roll-rock";

const WIDTH = 64;

/** The seam is local row 5: its foot is on `groundTop` exactly, so the lip owns it. */
const FRAME: CameraFrame = {
  groundTop: 40,
  rollHeight: 24,
  footX: 32,
  footY: 100,
  phaseX: 0,
  phaseY: 0,
};

const SEAM_ROW = 5;

/** Every texel says where it is - red its column, green its row, blue which tile. */
function patternTile(id: number, rows: number): TileTexels {
  const rgba = new Uint8ClampedArray(TILE_WIDTH * rows * 4);
  for (let v = 0; v < rows; v += 1) {
    for (let u = 0; u < TILE_WIDTH; u += 1) {
      rgba.set([u * 8 + 1, v * 12 + 1, id * 40, 255], (v * TILE_WIDTH + u) * 4);
    }
  }
  return { width: TILE_WIDTH, rgba };
}

function rock(id: number): RockLook {
  return { cap: patternTile(id, TILE_DEPTH), face: patternTile(id + 1, WALL_RISE) };
}

const NEAR = rock(1);
const FAR = rock(3);
const NO_HAZE = { r: 0, g: 0, b: 0 };

function rocksAt(rows: Readonly<Record<number, RockLook>>): RockAt {
  return (_cellX, cellY) => rows[cellY] ?? null;
}

function band(frame: CameraFrame = FRAME): Uint8ClampedArray {
  return new Uint8ClampedArray(WIDTH * frame.groundTop * 4);
}

function pixelAt(rgba: Uint8ClampedArray, x: number, y: number): readonly number[] {
  const at = (y * WIDTH + x) * 4;
  return [rgba[at] ?? -1, rgba[at + 1] ?? -1, rgba[at + 2] ?? -1, rgba[at + 3] ?? -1];
}

function texel(tile: TileTexels, u: number, v: number): readonly number[] {
  const at = (v * tile.width + u) * 4;
  return [tile.rgba[at] ?? -1, tile.rgba[at + 1] ?? -1, tile.rgba[at + 2] ?? -1, 255];
}

describe("rockSamples", () => {
  const samples = rockSamples(FRAME.groundTop, FRAME.rollHeight);

  it("starts on the seam with the field's own wall", () => {
    expect(samples[0]?.rowsBeyond).toBe(0);
    expect(samples[0]?.groundY).toBe(FRAME.groundTop);
    expect(samples[0]?.rise).toBe(WALL_RISE);
    expect(samples[0]?.fog).toBe(0);
  });

  it("climbs the roll and shrinks, never skipping a scanline of wall-top or a row of ground", () => {
    for (let index = 1; index < samples.length; index += 1) {
      const here = samples[index];
      const before = samples[index - 1];
      expect(here?.groundY).toBeLessThanOrEqual(before?.groundY ?? 0);
      expect(here?.rise).toBeLessThanOrEqual(before?.rise ?? 0);
      expect((here?.rowsBeyond ?? 0) - (before?.rowsBeyond ?? 0)).toBeLessThanOrEqual(1 + 1e-9);
      const climb = (before?.groundY ?? 0) - (before?.rise ?? 0) - ((here?.groundY ?? 0) - (here?.rise ?? 0));
      expect(Math.abs(climb)).toBeLessThanOrEqual(1.05);
    }
    expect(samples[samples.length - 1]?.rowsBeyond).toBeLessThanOrEqual(ROLL_ROWS);
    expect(samples[samples.length - 1]?.rowsBeyond).toBeGreaterThan(ROLL_ROWS - 1);
  });

  it("sinks a body behind the curve over the last rows before the horizon", () => {
    const sinking = samples.filter((sample) => sample.rowsBeyond > ROLL_ROWS - HORIZON_SINK);
    expect(sinking.length).toBeGreaterThan(0);
    for (const sample of sinking) {
      expect(sample.rise).toBeLessThan(WALL_RISE * sample.scale);
      expect(sample.scale).toBeGreaterThanOrEqual(HORIZON_SCALE);
    }
    expect(samples[samples.length - 1]?.rise).toBeLessThan(0.5);
  });

  it("is empty with no roll", () => {
    expect(rockSamples(40, 0)).toEqual([]);
  });
});

describe("paintRollRock", () => {
  it("leaves the band alone over open ground", () => {
    const rgba = band();
    paintRollRock(FRAME, WIDTH, () => null, NO_HAZE, rgba);
    expect(rgba.every((value) => value === 0)).toBe(true);
  });

  it("stands a wall on the seam exactly where the field would: face under, cap's near row over it", () => {
    const rgba = band();
    paintRollRock(FRAME, WIDTH, rocksAt({ [SEAM_ROW]: NEAR }), NO_HAZE, rgba);
    const top = FRAME.groundTop - WALL_RISE;
    for (const x of [FRAME.footX, FRAME.footX - 5, FRAME.footX + 7]) {
      const u = (((x - FRAME.footX + TILE_WIDTH / 2) % TILE_WIDTH) + TILE_WIDTH) % TILE_WIDTH;
      for (let row = 0; row < WALL_RISE; row += 1) {
        expect(pixelAt(rgba, x, top + row)).toEqual(texel(NEAR.face, u, row));
      }
      expect(pixelAt(rgba, x, top - 1)).toEqual(texel(NEAR.cap, u, TILE_DEPTH - 1));
    }
  });

  it("leaves a cell whose foot is still on the field to the field", () => {
    // Half a step on, row 5's foot is six scanlines below the seam: the ground
    // layer stands it, and the lip must not stand a second copy behind it.
    const frame = { ...FRAME, phaseY: 0.5 };
    const rgba = band(frame);
    paintRollRock(frame, WIDTH, rocksAt({ [SEAM_ROW]: NEAR }), NO_HAZE, rgba);
    expect(rgba.every((value) => value === 0)).toBe(true);
  });

  it("hides a farther wall behind a nearer one", () => {
    const rgba = band();
    paintRollRock(FRAME, WIDTH, rocksAt({ [SEAM_ROW]: NEAR, [SEAM_ROW + 3]: FAR }), NO_HAZE, rgba);
    const blue = (y: number): number => pixelAt(rgba, FRAME.footX, y)[2] ?? -1;
    // The near face fills the wall's height; the far wall shows only above the near cap.
    for (let y = FRAME.groundTop - WALL_RISE; y < FRAME.groundTop; y += 1) {
      expect(blue(y)).toBe(2 * 40);
    }
    const painted = Array.from({ length: FRAME.groundTop }, (_unused, y) => blue(y));
    const firstNear = painted.findIndex((value) => value === 40 || value === 80);
    const farAbove = painted.slice(0, firstNear).some((value) => value === 3 * 40 || value === 4 * 40);
    expect(farAbove).toBe(true);
    expect(painted.slice(firstNear).some((value) => value === 3 * 40 || value === 4 * 40)).toBe(false);
  });

  it("rises past the horizon line into the sky a few rows out", () => {
    const rgba = band();
    paintRollRock(FRAME, WIDTH, rocksAt({ 7: NEAR, 8: NEAR }), NO_HAZE, rgba);
    const horizonY = FRAME.groundTop - FRAME.rollHeight;
    const sky = Array.from({ length: horizonY }, (_unused, y) => pixelAt(rgba, FRAME.footX, y)[3]);
    expect(sky.some((alpha) => alpha === 255)).toBe(true);
  });

  it("takes on the haze it is handed, out toward the horizon", () => {
    const white = { r: 255, g: 255, b: 255 };
    const far = { [SEAM_ROW + ROLL_ROWS - HORIZON_SINK - 4]: NEAR };
    const clear = band();
    const hazy = band();
    paintRollRock(FRAME, WIDTH, rocksAt(far), NO_HAZE, clear);
    paintRollRock(FRAME, WIDTH, rocksAt(far), white, hazy);
    let brighter = 0;
    let painted = 0;
    for (let at = 0; at < clear.length; at += 4) {
      if (clear[at + 3] === 255) {
        painted += 1;
        brighter += (hazy[at + 1] ?? 0) > (clear[at + 1] ?? 0) ? 1 : 0;
      }
    }
    expect(painted).toBeGreaterThan(0);
    expect(brighter / painted).toBeGreaterThan(0.5);
  });

  it("paints a far wall in its far colours without composing its tiles", () => {
    let composed = 0;
    const lazy: RockLook = {
      get cap() {
        composed += 1;
        return NEAR.cap;
      },
      get face() {
        composed += 1;
        return NEAR.face;
      },
      far: { cap: 0x00ff00, face: 0x0000ff },
    };
    const rgba = band();
    paintRollRock(FRAME, WIDTH, rocksAt({ [SEAM_ROW + 30]: lazy }), NO_HAZE, rgba);
    let painted = 0;
    for (let at = 0; at < rgba.length; at += 4) {
      painted += rgba[at + 3] === 255 ? 1 : 0;
    }
    expect(painted).toBeGreaterThan(0);
    expect(composed).toBe(0);
  });

  it("does nothing without a roll", () => {
    const frame = { ...FRAME, rollHeight: 0 };
    const rgba = band(frame);
    paintRollRock(frame, WIDTH, rocksAt({ [SEAM_ROW]: NEAR }), NO_HAZE, rgba);
    expect(rgba.every((value) => value === 0)).toBe(true);
  });

  it("is deterministic", () => {
    const first = band();
    const second = band();
    paintRollRock({ ...FRAME, phaseX: 0.3 }, WIDTH, rocksAt({ 6: NEAR, 9: FAR }), NO_HAZE, first);
    paintRollRock({ ...FRAME, phaseX: 0.3 }, WIDTH, rocksAt({ 6: NEAR, 9: FAR }), NO_HAZE, second);
    expect(first).toEqual(second);
  });
});

describe("faceTexels", () => {
  it("keeps a hole in the face art a hole, so what is behind shows through it", () => {
    const grid = createGrid(2, 1, "stone-2");
    setGrid(grid, 1, 0, null);
    const texels = faceTexels(grid);
    expect(texels.rgba[3]).toBe(255);
    expect(texels.rgba[7]).toBe(0);
  });

  it("skips a transparent face texel when it paints", () => {
    const holed: RockLook = { cap: NEAR.cap, face: { width: TILE_WIDTH, rgba: new Uint8ClampedArray(TILE_WIDTH * WALL_RISE * 4) } };
    const rgba = band();
    paintRollRock(FRAME, WIDTH, rocksAt({ [SEAM_ROW]: holed }), NO_HAZE, rgba);
    expect(pixelAt(rgba, FRAME.footX, FRAME.groundTop - 1)[3]).toBe(0);
  });
});
