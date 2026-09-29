import { describe, expect, it } from "vitest";

import { scrollOffset, type CameraFrame } from "./camera";
import { hexToRgb } from "./color";
import { ROLL_ROWS, rollHaze } from "./horizon";
import { INK_COLORS } from "./ink";
import { rasterizeSprite } from "./pixel-art";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import { rollFog, rollGroundPixels, rollScanlines, TUFT_ROWS, type CellLook } from "./roll-ground";
import type { Terrain } from "./terrain";
import { DIRT_PATH, GRASS } from "./tiles";

const WIDTH = 64;

const FRAME: CameraFrame = {
  groundTop: 40,
  rollHeight: 24,
  footX: 32,
  footY: 100,
  phaseX: 0,
  phaseY: 0,
};

const ALL_GRASS: CellLook = { terrain: () => "grass", tuft: () => null };

function pixelAt(rgba: Uint8ClampedArray, x: number, row: number): readonly number[] {
  const at = (row * WIDTH + x) * 4;
  return [rgba[at] ?? -1, rgba[at + 1] ?? -1, rgba[at + 2] ?? -1, rgba[at + 3] ?? -1];
}

/** What the flat tile blit puts at a screen pixel, if every cell were `terrain`. */
function fieldPixel(frame: CameraFrame, x: number, y: number, terrain: Terrain): readonly number[] {
  const tile = rasterizeSprite(terrain === "dirt" ? DIRT_PATH : GRASS);
  const shift = scrollOffset(frame);
  const u = (((x - frame.footX - shift.x + TILE_WIDTH / 2) % TILE_WIDTH) + TILE_WIDTH) % TILE_WIDTH;
  // A cell's tile spans foot - TILE_DEPTH .. foot - 1, with feet every TILE_DEPTH.
  const v = (((y - (frame.footY + shift.y)) % TILE_DEPTH) + TILE_DEPTH) % TILE_DEPTH;
  const at = (v * tile.width + u) * 4;
  return [tile.rgba[at] ?? -1, tile.rgba[at + 1] ?? -1, tile.rgba[at + 2] ?? -1, 255];
}

describe("rollScanlines", () => {
  it("covers the roll top first, one per scanline", () => {
    const lines = rollScanlines(FRAME);

    expect(lines).toHaveLength(FRAME.rollHeight);
    expect(lines[0]?.y).toBe(FRAME.groundTop - FRAME.rollHeight);
    expect(lines[lines.length - 1]?.y).toBe(FRAME.groundTop - 1);
  });

  it("puts the bottom scanline half a scanline past the seam, where the field would", () => {
    const bottom = rollScanlines(FRAME)[FRAME.rollHeight - 1];

    expect(bottom?.rowsBeyond).toBeCloseTo(0.5 / TILE_DEPTH, 3);
    expect(bottom?.scale).toBeGreaterThan(0.999);
    expect(bottom?.fog).toBeLessThan(0.001);
  });

  it("reaches out toward the horizon, smaller and hazier the higher it goes", () => {
    const lines = rollScanlines(FRAME);
    for (let index = 1; index < lines.length; index += 1) {
      const above = lines[index - 1];
      const below = lines[index];
      expect(above?.rowsBeyond).toBeGreaterThan(below?.rowsBeyond ?? 0);
      expect(above?.scale).toBeLessThan(below?.scale ?? 0);
      expect(above?.fog).toBeGreaterThan(below?.fog ?? 0);
    }
    expect(lines[0]?.rowsBeyond).toBeLessThanOrEqual(ROLL_ROWS);
    expect(lines[0]?.rowsBeyond).toBeGreaterThan(ROLL_ROWS / 3);
  });

  it("has nothing to draw with no roll", () => {
    expect(rollScanlines({ ...FRAME, rollHeight: 0 })).toEqual([]);
  });
});

describe("rollFog", () => {
  it("is clear at the seam, total at the horizon, and clamps either side", () => {
    expect(rollFog(0)).toBe(0);
    expect(rollFog(1)).toBe(1);
    expect(rollFog(-1)).toBe(0);
    expect(rollFog(2)).toBe(1);
    expect(rollFog(0.5)).toBeLessThan(0.5);
  });
});

describe("rollGroundPixels", () => {
  it("is the tile blit exactly at the seam, so the field runs onto the lip without a line", () => {
    for (const phaseY of [0, 0.25, 0.5, 0.75]) {
      for (const phaseX of [0, 0.5]) {
        const frame = { ...FRAME, phaseX, phaseY };
        const rgba = rollGroundPixels(frame, WIDTH, ALL_GRASS);
        const row = frame.rollHeight - 1;
        for (let x = 0; x < WIDTH; x += 1) {
          expect(pixelAt(rgba, x, row)).toEqual(fieldPixel(frame, x, frame.groundTop - 1, "grass"));
        }
      }
    }
  });

  it("reads which tile to sample from the terrain of the cell", () => {
    const dirt: CellLook = { terrain: () => "dirt", tuft: () => null };
    const rgba = rollGroundPixels(FRAME, WIDTH, dirt);
    const row = FRAME.rollHeight - 1;
    for (let x = 0; x < WIDTH; x += 1) {
      expect(pixelAt(rgba, x, row)).toEqual(fieldPixel(FRAME, x, FRAME.groundTop - 1, "dirt"));
    }
  });

  it("stamps a tuft where the field draws it, blades leaning over the cell edge included", () => {
    // A cell whose foot is exactly on groundTop: its tuft's row -1 is the lip's
    // bottom scanline. Local y 5 puts the foot at 100 - 5 * 12 = 40.
    const ink = "neon-green";
    const look: CellLook = {
      terrain: () => "grass",
      tuft: (cellX, cellY) =>
        cellX === 0 && cellY === 5
          ? [
              { x: 2, y: -1, ink },
              { x: -9, y: -1, ink },
            ]
          : null,
    };
    const rgba = rollGroundPixels(FRAME, WIDTH, look);
    const green = hexToRgb(INK_COLORS[ink]);
    const row = FRAME.rollHeight - 1;

    expect(pixelAt(rgba, FRAME.footX + 2, row)).toEqual([green.r, green.g, green.b, 255]);
    expect(pixelAt(rgba, FRAME.footX - 9, row)).toEqual([green.r, green.g, green.b, 255]);
    expect(pixelAt(rgba, FRAME.footX + 3, row)).toEqual(
      fieldPixel(FRAME, FRAME.footX + 3, FRAME.groundTop - 1, "grass"),
    );
  });

  it("dissolves into the haze toward the horizon line", () => {
    const rgba = rollGroundPixels(FRAME, WIDTH, ALL_GRASS);
    const top = rollScanlines(FRAME)[0];
    const haze = hexToRgb(rollHaze(top?.rowsBeyond ?? 0));
    let hazy = 0;
    for (let x = 0; x < WIDTH; x += 1) {
      const [r, g, b] = pixelAt(rgba, x, 0);
      if (r === haze.r && g === haze.g && b === haze.b) {
        hazy += 1;
      }
    }
    expect(hazy / WIDTH).toBeGreaterThan(0.85);
  });

  it("is opaque everywhere, so no tile hanging above the seam shows through", () => {
    const rgba = rollGroundPixels({ ...FRAME, phaseY: 0.4 }, WIDTH, ALL_GRASS);
    for (let at = 3; at < rgba.length; at += 4) {
      expect(rgba[at]).toBe(255);
    }
  });

  it("asks for tufts only near the seam, where a blade can still be seen", () => {
    // A work count, not a stopwatch: at full width a scanline far up the lip
    // crosses a hundred cells, and stamping every one of their tufts each frame
    // cost more than everything else on the lip together. 299 when written.
    const frame = { ...FRAME, footX: 160 };
    const seam = (frame.footY - frame.groundTop) / TILE_DEPTH;
    let asked = 0;
    let farthest = Number.NEGATIVE_INFINITY;
    rollGroundPixels(frame, 320, {
      terrain: () => "grass",
      tuft: (_cellX, cellY) => {
        asked += 1;
        farthest = Math.max(farthest, cellY);
        return null;
      },
    });

    expect(farthest).toBeLessThanOrEqual(seam + TUFT_ROWS + 1);
    expect(asked).toBeLessThanOrEqual(320);
  });

  it("is deterministic, and empty with no roll", () => {
    expect(rollGroundPixels(FRAME, WIDTH, ALL_GRASS)).toEqual(rollGroundPixels(FRAME, WIDTH, ALL_GRASS));
    expect(rollGroundPixels({ ...FRAME, rollHeight: 0 }, WIDTH, ALL_GRASS)).toHaveLength(0);
  });
});
