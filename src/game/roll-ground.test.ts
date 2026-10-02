import { describe, expect, it } from "vitest";

import { scrollOffset, type CameraFrame } from "./camera";
import { hexToRgb, type Rgb } from "./color";
import { createGrid, setGrid } from "./ground/ink-grid";
import { ROLL_ROWS } from "./horizon";
import { INK_COLORS, type PixelCloud } from "./ink";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import {
  distantShare,
  gridTexels,
  HAZE_STEPS,
  hazeInto,
  HORIZON_HAZE,
  lipBounds,
  rollFog,
  rollGroundPixels,
  rollScanlines,
  tileLook,
  type CellLook,
  type TileTexels,
  type WaterLook,
} from "./roll-ground";
import { FAR_LEVELS, farLook } from "./roll-far";
import { packCloud, TUFT_ROWS, type TuftPiece } from "./roll-grass";

const WIDTH = 64;

const FRAME: CameraFrame = {
  groundTop: 40,
  rollHeight: 24,
  footX: 32,
  footY: 100,
  phaseX: 0,
  phaseY: 0,
};

const HAZE: Rgb = { r: 201, g: 202, b: 203 };

/**
 * A tile whose every texel says where it is - red the column, green the row,
 * blue which tile - so a pixel landing one texel off is a failed assertion,
 * not a coincidence of flat art.
 */
function patternTile(id: number): TileTexels {
  const rgba = new Uint8ClampedArray(TILE_WIDTH * TILE_DEPTH * 4);
  for (let v = 0; v < TILE_DEPTH; v += 1) {
    for (let u = 0; u < TILE_WIDTH; u += 1) {
      rgba.set([u * 8 + 1, v * 16 + 1, id * 40, 255], (v * TILE_WIDTH + u) * 4);
    }
  }
  return { width: TILE_WIDTH, rgba };
}

const MEADOW = patternTile(1);
const PATH = patternTile(2);

const ALL_MEADOW: CellLook = { tile: () => MEADOW, tuft: () => null };

/** One pixel as a cell's only tuft, rooted at the cell's foot. */
function piece(pixel: PixelCloud[number]): TuftPiece[] {
  return [{ cloud: packCloud([pixel]), x: 0, y: 0 }];
}

function pixelAt(rgba: Uint8ClampedArray, x: number, row: number, width = WIDTH): readonly number[] {
  const at = (row * width + x) * 4;
  return [rgba[at] ?? -1, rgba[at + 1] ?? -1, rgba[at + 2] ?? -1, rgba[at + 3] ?? -1];
}

/** What the flat tile blit puts at a screen pixel, if every cell were `tile`. */
function fieldPixel(frame: CameraFrame, x: number, y: number, tile: TileTexels): readonly number[] {
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
      expect(above?.stride).toBeGreaterThanOrEqual(below?.stride ?? 0);
    }
    expect(lines[0]?.rowsBeyond).toBeLessThanOrEqual(ROLL_ROWS);
    expect(lines[0]?.rowsBeyond).toBeGreaterThan(ROLL_ROWS / 3);
  });

  it("has nothing to draw with no roll", () => {
    expect(rollScanlines({ ...FRAME, rollHeight: 0 })).toEqual([]);
  });
});

describe("rollFog", () => {
  it("is clear at the seam, a tint rather than a wall at the horizon, and clamps either side", () => {
    expect(rollFog(0)).toBe(0);
    expect(rollFog(1)).toBe(HORIZON_HAZE);
    expect(HORIZON_HAZE).toBeLessThan(1);
    expect(rollFog(-1)).toBe(0);
    expect(rollFog(2)).toBe(HORIZON_HAZE);
  });

  it("leaves the near half of the lip untouched, so it reads as the field carried on", () => {
    expect(rollFog(0.5) * HAZE_STEPS).toBeLessThan(1);
  });
});

describe("hazeInto", () => {
  const pixel = (): Uint8ClampedArray => new Uint8ClampedArray([40, 120, 30, 255]);

  it("does nothing without air", () => {
    const rgba = pixel();
    hazeInto(rgba, 0, HAZE, 0, 0, 0);
    expect(Array.from(rgba)).toEqual([40, 120, 30, 255]);
  });

  it("tints toward the haze by a whole step, never all the way at the horizon's share", () => {
    const rgba = pixel();
    hazeInto(rgba, 0, HAZE, HORIZON_HAZE, 0, 0);
    const [r, g, b] = Array.from(rgba);
    expect(r).toBeGreaterThan(40);
    expect(r).toBeLessThan(HAZE.r);
    expect(b).toBeGreaterThan(30);
    expect(g).not.toBe(HAZE.g);
  });

  it("dithers between neighbouring steps only: two pixels of one share differ by at most a step", () => {
    const fog = 2.5 / HAZE_STEPS;
    const shares = [0, 1, 2, 3].map((x) => {
      const rgba = new Uint8ClampedArray([0, 0, 0, 255]);
      hazeInto(rgba, 0, { r: 255, g: 255, b: 255 }, fog, x, 0);
      return Math.round(((rgba[0] ?? 0) / 255) * HAZE_STEPS);
    });
    expect(new Set(shares)).toEqual(new Set([2, 3]));
  });
});

describe("tileLook", () => {
  it("is the tile's own inks in their shares - never an average", () => {
    const grid = createGrid(4, 2, "grass-3");
    setGrid(grid, 2, 1, "stone-2");
    setGrid(grid, 3, 1, "stone-2");
    const pack = (ink: "grass-3" | "stone-2"): number => {
      const { r, g, b } = hexToRgb(INK_COLORS[ink]);
      return (r << 16) | (g << 8) | b;
    };
    const { table } = tileLook(gridTexels(grid));
    expect(table.filter((colour) => colour === pack("grass-3"))).toHaveLength(FAR_LEVELS * 0.75);
    expect(table.filter((colour) => colour === pack("stone-2"))).toHaveLength(FAR_LEVELS * 0.25);
  });

  it("does not count a hole as a colour", () => {
    const rgba = new Uint8ClampedArray(4 * 4);
    rgba.set([10, 20, 30, 255], 0);
    expect(new Set(tileLook({ width: 4, rgba }).table)).toEqual(new Set([(10 << 16) | (20 << 8) | 30]));
  });

  it("is counted once per tile", () => {
    expect(tileLook(MEADOW)).toBe(tileLook(MEADOW));
  });
});

describe("distantShare", () => {
  it("point-samples while a pixel spans a texel or two, and settles wholly to the far look by half a tile", () => {
    expect(distantShare(1)).toBe(0);
    expect(distantShare(2)).toBe(0);
    expect(distantShare(4)).toBeGreaterThan(0);
    expect(distantShare(4)).toBeLessThan(1);
    expect(distantShare(TILE_WIDTH / 2)).toBe(1);
    expect(distantShare(40)).toBe(1);
  });
});

describe("lipBounds", () => {
  it("holds every cell any lip pixel reads, at every phase of a stride", () => {
    const width = 320;
    const frame = { ...FRAME, footX: 160 };
    const bounds = lipBounds(frame, width);
    const visited: { cellX: number; cellY: number }[] = [];
    for (const phaseY of [-0.9, 0, 0.9]) {
      for (const phaseX of [-0.9, 0, 0.9]) {
        rollGroundPixels(
          { ...frame, phaseX, phaseY },
          width,
          {
            tile: (cellX, cellY) => {
              visited.push({ cellX, cellY });
              return MEADOW;
            },
            tuft: (cellX, cellY) => {
              visited.push({ cellX, cellY });
              return null;
            },
          },
          HAZE,
        );
      }
    }
    expect(visited.length).toBeGreaterThan(0);
    for (const { cellX, cellY } of visited) {
      expect(cellX).toBeGreaterThanOrEqual(bounds.minX);
      expect(cellX).toBeLessThanOrEqual(bounds.maxX);
      expect(cellY).toBeGreaterThanOrEqual(bounds.minY);
      expect(cellY).toBeLessThanOrEqual(bounds.maxY);
    }
  });

  it("widens with the screen and reaches out to the horizon", () => {
    const seam = (FRAME.footY - FRAME.groundTop) / TILE_DEPTH;
    const narrow = lipBounds(FRAME, 64);
    const wide = lipBounds(FRAME, 320);
    expect(wide.maxX - wide.minX).toBeGreaterThan(narrow.maxX - narrow.minX);
    expect(narrow.maxY).toBeGreaterThanOrEqual(seam + ROLL_ROWS);
    expect(narrow.minY).toBeLessThan(seam);
  });
});

describe("gridTexels", () => {
  it("spells each ink of a tile as its colour, row by row, opaque", () => {
    const grid = createGrid(3, 2, "grass-3");
    setGrid(grid, 2, 1, "stone-2");
    const texels = gridTexels(grid);
    const grass = hexToRgb(INK_COLORS["grass-3"]);
    const stone = hexToRgb(INK_COLORS["stone-2"]);

    expect(texels.width).toBe(3);
    expect(texels.rgba).toHaveLength(3 * 2 * 4);
    expect(Array.from(texels.rgba.slice(0, 4))).toEqual([grass.r, grass.g, grass.b, 255]);
    expect(Array.from(texels.rgba.slice(20, 24))).toEqual([stone.r, stone.g, stone.b, 255]);
  });

  it("fills a transparent pixel with opaque black rather than a hole", () => {
    const texels = gridTexels(createGrid(1, 1));
    expect(Array.from(texels.rgba)).toEqual([0, 0, 0, 255]);
  });
});

describe("rollGroundPixels", () => {
  it("is the tile blit exactly at the seam, so the field runs onto the lip without a line", () => {
    for (const phaseY of [0, 0.25, 0.5, 0.75]) {
      for (const phaseX of [0, 0.5]) {
        const frame = { ...FRAME, phaseX, phaseY };
        const rgba = rollGroundPixels(frame, WIDTH, ALL_MEADOW, HAZE);
        const row = frame.rollHeight - 1;
        for (let x = 0; x < WIDTH; x += 1) {
          expect(pixelAt(rgba, x, row)).toEqual(fieldPixel(frame, x, frame.groundTop - 1, MEADOW));
        }
      }
    }
  });

  it("reads each cell's own tile", () => {
    // Odd columns are path: the seam scanline alternates tiles cell by cell.
    const look: CellLook = { tile: (cellX) => (Math.abs(cellX) % 2 === 1 ? PATH : MEADOW), tuft: () => null };
    const rgba = rollGroundPixels(FRAME, WIDTH, look, HAZE);
    const row = FRAME.rollHeight - 1;
    for (let x = 0; x < WIDTH; x += 1) {
      const cellX = Math.floor((x + 0.5 - FRAME.footX) / TILE_WIDTH + 0.5);
      const tile = Math.abs(cellX) % 2 === 1 ? PATH : MEADOW;
      expect(pixelAt(rgba, x, row)).toEqual(fieldPixel(FRAME, x, FRAME.groundTop - 1, tile));
    }
  });

  it("stamps a tuft where the field draws it, blades leaning over the cell edge included", () => {
    // A cell whose foot is exactly on groundTop: its tuft's row -1 is the lip's
    // bottom scanline. Local y 5 puts the foot at 100 - 5 * 12 = 40.
    const ink = "neon-green";
    const look: CellLook = {
      tile: () => MEADOW,
      // Two tufts, each placed from the foot by its own offset.
      tuft: (cellX, cellY) =>
        cellX === 0 && cellY === 5
          ? [
              { cloud: packCloud([{ x: 0, y: 0, ink }]), x: 2, y: -1 },
              { cloud: packCloud([{ x: -4, y: -1, ink }]), x: -5, y: 0 },
            ]
          : null,
    };
    const rgba = rollGroundPixels(FRAME, WIDTH, look, HAZE);
    const green = hexToRgb(INK_COLORS[ink]);
    const row = FRAME.rollHeight - 1;

    expect(pixelAt(rgba, FRAME.footX + 2, row)).toEqual([green.r, green.g, green.b, 255]);
    expect(pixelAt(rgba, FRAME.footX - 9, row)).toEqual([green.r, green.g, green.b, 255]);
    expect(pixelAt(rgba, FRAME.footX + 3, row)).toEqual(fieldPixel(FRAME, FRAME.footX + 3, FRAME.groundTop - 1, MEADOW));
  });

  it("draws a tall blade over the farther cell it rises into, though that cell is drawn first", () => {
    // Scanlines are drawn far first, so the cell a blade rises into is reached
    // before the cell it grows from. The seam is at local y 5, so world texel
    // rows 60..71 are cell 5 and 72.. cell 6: find the nearest scanline showing
    // cell 6, and grow a blade from cell 5's foot up to exactly that texel.
    const seam = (FRAME.footY - FRAME.groundTop) / TILE_DEPTH;
    const lines = rollScanlines(FRAME);
    const texelRow = (index: number): number => Math.floor((seam + (lines[index]?.rowsBeyond ?? 0)) * TILE_DEPTH);
    const row = lines.findLastIndex((_line, index) => texelRow(index) >= 6 * TILE_DEPTH);
    const ink = "neon-green";
    const look: CellLook = {
      tile: () => MEADOW,
      tuft: (cellX, cellY) =>
        cellX === 0 && cellY === 5 ? piece({ x: 0, y: 5 * TILE_DEPTH - texelRow(row) - 1, ink }) : null,
    };
    const green = hexToRgb(INK_COLORS[ink]);

    expect(row).toBeGreaterThan(0);
    expect(texelRow(row)).toBeLessThan(6 * TILE_DEPTH + 2);
    // Still big enough that the hero's own column reads the middle of cell 0.
    expect(lines[row]?.scale).toBeGreaterThan(0.5);
    expect(pixelAt(rollGroundPixels(FRAME, WIDTH, look, HAZE), FRAME.footX, row)).toEqual([
      green.r,
      green.g,
      green.b,
      255,
    ]);
  });

  it("lets a sheer ink - a tuft's soft contact shadow - darken the tile rather than replace it", () => {
    const look: CellLook = {
      tile: () => MEADOW,
      tuft: (cellX, cellY) => (cellX === 0 && cellY === 5 ? piece({ x: 0, y: -1, ink: "shadow-soft" }) : null),
    };
    const row = FRAME.rollHeight - 1;
    const under = fieldPixel(FRAME, FRAME.footX, FRAME.groundTop - 1, MEADOW);
    const [r, g, b] = pixelAt(rollGroundPixels(FRAME, WIDTH, look, HAZE), FRAME.footX, row);

    expect([r, g, b]).not.toEqual(under.slice(0, 3));
    expect((r ?? 0) + (g ?? 0) + (b ?? 0)).toBeLessThan((under[0] ?? 0) + (under[1] ?? 0) + (under[2] ?? 0));
  });

  it("takes on the haze toward the horizon line, and is still ground there rather than haze", () => {
    // The regression: the far lip used to be dithered *to* the haze, and since
    // the lip folds forty rows into its top scanlines the horizon read as a
    // grey band that turned green only as it rolled onto the field.
    const ground = [30, 90, 40];
    const rgba = new Uint8ClampedArray(TILE_WIDTH * TILE_DEPTH * 4).map((_unused, at) =>
      at % 4 === 3 ? 255 : (ground[at % 4] ?? 0),
    );
    const flat: CellLook = { tile: () => ({ width: TILE_WIDTH, rgba }), tuft: () => null };
    const lip = rollGroundPixels(FRAME, WIDTH, flat, HAZE);
    const distance = (a: readonly number[], b: readonly number[]): number =>
      Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
    const haze = [HAZE.r, HAZE.g, HAZE.b];
    for (let x = 0; x < WIDTH; x += 1) {
      const top = pixelAt(lip, x, 0).slice(0, 3);
      expect(top).not.toEqual(haze);
      expect(distance(top, haze)).toBeLessThan(distance(ground, haze));
    }
  });

  it("settles a far scanline onto a screen-locked pick of its cell's colours, so a step of scroll cannot reshuffle it", () => {
    const top = rollScanlines(FRAME)[0];
    expect(distantShare(top?.stride ?? 0)).toBeGreaterThan(0.5);
    const unhazed = rollGroundPixels(FRAME, WIDTH, ALL_MEADOW, { r: 0, g: 0, b: 0 });
    const shifted = rollGroundPixels({ ...FRAME, phaseX: 0.25 }, WIDTH, ALL_MEADOW, { r: 0, g: 0, b: 0 });
    let same = 0;
    for (let x = 0; x < WIDTH; x += 1) {
      if (pixelAt(unhazed, x, 0).join() === pixelAt(shifted, x, 0).join()) {
        same += 1;
      }
    }
    expect(same / WIDTH).toBeGreaterThan(0.5);
  });

  it("shows a far cell's far look without composing its tile", () => {
    // Composing a far cell's tile reads the lattice round it, and the far lip
    // crosses a hundred cells a scanline: that was a step frame's worst stall.
    const composed = new Set<number>();
    const look: CellLook = {
      tile: (cellX, cellY) => {
        composed.add(cellY);
        return MEADOW;
      },
      tuft: () => null,
      far: () => farLook(new Map([[0x123456, 1]])),
    };
    // Haze the far look's one colour itself, so the air's tint leaves it as it is.
    const rgba = rollGroundPixels(FRAME, WIDTH, look, { r: 0x12, g: 0x34, b: 0x56 });
    const top = rollScanlines(FRAME)[0];
    expect(distantShare(top?.stride ?? 0)).toBe(1);
    expect(pixelAt(rgba, 5, 0)).toEqual([0x12, 0x34, 0x56, 255]);
    const seam = (FRAME.footY - FRAME.groundTop) / TILE_DEPTH;
    const farthestComposed = Math.max(...composed);
    expect(farthestComposed).toBeLessThan(seam + ROLL_ROWS / 4);
  });

  it("shows a far look in its shares rather than its commonest colour alone, so the lip keeps the field's shade", () => {
    // Half dark, half light, under a mid-grey haze: at most half-way to the
    // haze, a dark pixel stays dark and a light one light.
    const look: CellLook = {
      tile: () => MEADOW,
      tuft: () => null,
      far: () => farLook(new Map([[0x000000, 1], [0xffffff, 1]])),
    };
    const width = 320;
    const rgba = rollGroundPixels({ ...FRAME, footX: 160 }, width, look, { r: 128, g: 128, b: 128 });
    const reds = Array.from({ length: width }, (_unused, x) => pixelAt(rgba, x, 0, width)[0] ?? 0);
    expect(reds.filter((red) => red < 100).length).toBeGreaterThan(width * 0.35);
    expect(reds.filter((red) => red > 160).length).toBeGreaterThan(width * 0.35);
  });

  it("lays water over the tile where the lip's water says, and keeps the grass off it", () => {
    const blue = [10, 40, 200];
    const water: WaterLook = {
      wetCell: (cellX, cellY) => cellX === 0 && cellY === 5,
      blendInto: (_gx, _gy, rgba, at) => {
        rgba.set(blue, at);
        return true;
      },
    };
    const look: CellLook = {
      tile: () => MEADOW,
      tuft: (cellX, cellY) => (cellX === 0 && cellY === 5 ? piece({ x: 0, y: -1, ink: "neon-green" }) : null),
      water,
    };
    const rgba = rollGroundPixels(FRAME, WIDTH, look, HAZE);
    const row = FRAME.rollHeight - 1;
    expect(pixelAt(rgba, FRAME.footX, row)).toEqual([...blue, 255]);
    // A dry cell is never asked, so the water costs nothing where there is none.
    expect(pixelAt(rgba, FRAME.footX + TILE_WIDTH, row)).toEqual(
      fieldPixel(FRAME, FRAME.footX + TILE_WIDTH, FRAME.groundTop - 1, MEADOW),
    );
  });

  it("is opaque everywhere, so no tile hanging above the seam shows through", () => {
    const rgba = rollGroundPixels({ ...FRAME, phaseY: 0.4 }, WIDTH, ALL_MEADOW, HAZE);
    for (let at = 3; at < rgba.length; at += 4) {
      expect(rgba[at]).toBe(255);
    }
  });

  it("asks for tufts only near the seam, where a blade can still be seen", () => {
    // A work count, not a stopwatch: at full width a scanline far up the lip
    // crosses a hundred cells, and stamping every one of their tufts each frame
    // cost more than everything else on the lip together. 299 when written;
    // 324 once the far lip stopped being dithered *to* haze, because the
    // pixels the haze used to replace are ground now and show their grass. A
    // blurred pixel asks for none (`distantShare`), which is what holds it there.
    const frame = { ...FRAME, footX: 160 };
    const seam = (frame.footY - frame.groundTop) / TILE_DEPTH;
    let asked = 0;
    let farthest = Number.NEGATIVE_INFINITY;
    rollGroundPixels(
      frame,
      320,
      {
        tile: () => MEADOW,
        tuft: (_cellX, cellY) => {
          asked += 1;
          farthest = Math.max(farthest, cellY);
          return null;
        },
      },
      HAZE,
    );

    expect(farthest).toBeLessThanOrEqual(seam + TUFT_ROWS + 1);
    expect(asked).toBeLessThanOrEqual(340);
  });

  it("is deterministic, and empty with no roll", () => {
    expect(rollGroundPixels(FRAME, WIDTH, ALL_MEADOW, HAZE)).toEqual(rollGroundPixels(FRAME, WIDTH, ALL_MEADOW, HAZE));
    expect(rollGroundPixels({ ...FRAME, rollHeight: 0 }, WIDTH, ALL_MEADOW, HAZE)).toHaveLength(0);
  });
});
