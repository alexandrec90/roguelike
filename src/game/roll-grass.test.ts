import { describe, expect, it } from "vitest";

import type { CameraFrame } from "./camera";
import { hexToRgb } from "./color";
import { INK_ALPHA, INK_COLORS } from "./ink";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import { packCloud, TUFT_ROWS, tuftBounds, TuftOverlay } from "./roll-grass";

const FRAME: CameraFrame = { groundTop: 40, rollHeight: 24, footX: 160, footY: 100, phaseX: 0, phaseY: 0 };
const BOUNDS = { minX: -2, maxX: 2, minY: 4, maxY: 7 };
const GREEN = hexToRgb(INK_COLORS["neon-green"]);

/** What the overlay lays over a black texel. */
function over(overlay: TuftOverlay, gx: number, gy: number): readonly number[] {
  const target = new Uint8ClampedArray([0, 0, 0, 255]);
  overlay.blendInto(gx, gy, target, 0);
  return Array.from(target);
}

/** World texel of a pixel `y` above a cell's foot, `x` right of its middle. */
function texel(cellX: number, cellY: number, x: number, y: number): readonly [number, number] {
  return [cellX * TILE_WIDTH + TILE_WIDTH / 2 + x, cellY * TILE_DEPTH - y - 1];
}

describe("tuftBounds", () => {
  it("runs from short of the seam to past the rows that carry grass", () => {
    const seam = (FRAME.footY - FRAME.groundTop) / TILE_DEPTH;
    const bounds = tuftBounds(FRAME, 320);
    expect(bounds.minY).toBeLessThan(seam);
    expect(bounds.maxY).toBeGreaterThan(seam + TUFT_ROWS);
  });

  it("is wider than the screen at full scale, and grows with it", () => {
    const narrow = tuftBounds({ ...FRAME, footX: 32 }, 64);
    const wide = tuftBounds(FRAME, 320);
    expect((wide.maxX - wide.minX) * TILE_WIDTH).toBeGreaterThan(320);
    expect(wide.maxX - wide.minX).toBeGreaterThan(narrow.maxX - narrow.minX);
  });
});

describe("packCloud", () => {
  it("resolves each pixel to its place, its ink's colour and that ink's own opacity", () => {
    const packed = packCloud([
      { x: 3, y: -2, ink: "neon-green" },
      { x: -1, y: 0, ink: "shadow-soft" },
    ]);
    const shadow = hexToRgb(INK_COLORS["shadow-soft"]);
    expect(Array.from(packed.data)).toEqual([
      3,
      -2,
      GREEN.r,
      GREEN.g,
      GREEN.b,
      255,
      -1,
      0,
      shadow.r,
      shadow.g,
      shadow.b,
      Math.round(INK_ALPHA["shadow-soft"] * 255),
    ]);
  });

  it("packs nothing to nothing", () => {
    expect(packCloud([]).data).toHaveLength(0);
  });
});

describe("TuftOverlay", () => {
  const blade = packCloud([{ x: 0, y: -3, ink: "neon-green" }]);

  it("lays a tuft in at its foot, moved by the piece's offset", () => {
    const overlay = new TuftOverlay(BOUNDS);
    overlay.stamp(0, 5, [{ cloud: blade, x: 2, y: -1 }]);
    const [gx, gy] = texel(0, 5, 2, -4);

    expect(over(overlay, gx, gy)).toEqual([GREEN.r, GREEN.g, GREEN.b, 255]);
    expect(over(overlay, gx + 1, gy)).toEqual([0, 0, 0, 255]);
  });

  it("remembers which cells it holds, and holds every cell outside it", () => {
    const overlay = new TuftOverlay(BOUNDS);
    expect(overlay.holds(0, 5)).toBe(false);
    overlay.stamp(0, 5, null);
    expect(overlay.holds(0, 5)).toBe(true);
    expect(overlay.holds(1, 5)).toBe(false);
    expect(overlay.holds(9, 5)).toBe(true);
    expect(overlay.holds(0, 99)).toBe(true);
  });

  it("drops a pixel that falls outside, and stamps nothing for a cell outside", () => {
    const overlay = new TuftOverlay(BOUNDS);
    overlay.stamp(2, 7, [{ cloud: packCloud([{ x: 40, y: -40, ink: "neon-green" }]), x: 0, y: 0 }]);
    overlay.stamp(9, 5, [{ cloud: blade, x: 0, y: 0 }]);
    const [gx, gy] = texel(9, 5, 0, -3);
    expect(over(overlay, gx, gy)).toEqual([0, 0, 0, 255]);
  });

  it("lets a sheer ink darken what is under it rather than replace it", () => {
    const overlay = new TuftOverlay(BOUNDS);
    overlay.stamp(0, 5, [{ cloud: packCloud([{ x: 0, y: 0, ink: "shadow-soft" }]), x: 0, y: 0 }]);
    const [gx, gy] = texel(0, 5, 0, 0);
    const target = new Uint8ClampedArray([200, 200, 200, 255]);
    overlay.blendInto(gx, gy, target, 0);

    expect(target[0]).toBeLessThan(200);
    expect(target[0]).toBeGreaterThan(0);
  });

  it("lets a later stamp win a texel", () => {
    const overlay = new TuftOverlay(BOUNDS);
    overlay.stamp(0, 5, [{ cloud: blade, x: 0, y: 0 }]);
    overlay.stamp(0, 4, [{ cloud: packCloud([{ x: 0, y: -3 - TILE_DEPTH, ink: "stone-4" }]), x: 0, y: 0 }]);
    const [gx, gy] = texel(0, 5, 0, -3);
    const stone = hexToRgb(INK_COLORS["stone-4"]);
    expect(over(overlay, gx, gy)).toEqual([stone.r, stone.g, stone.b, 255]);
  });

  it("forgets the rows it is told to, and the row their blades rise into, and no others", () => {
    const overlay = new TuftOverlay(BOUNDS);
    for (let cellY = BOUNDS.minY; cellY <= BOUNDS.maxY; cellY += 1) {
      overlay.stamp(0, cellY, [{ cloud: blade, x: 0, y: 0 }]);
    }
    overlay.forget(4, 5);

    expect(overlay.holds(0, 4)).toBe(false);
    expect(overlay.holds(0, 5)).toBe(false);
    expect(overlay.holds(0, 6)).toBe(false);
    expect(overlay.holds(0, 7)).toBe(true);
    expect(over(overlay, ...texel(0, 5, 0, -3))).toEqual([0, 0, 0, 255]);
    expect(over(overlay, ...texel(0, 6, 0, -3))).toEqual([0, 0, 0, 255]);
    expect(over(overlay, ...texel(0, 7, 0, -3))).toEqual([GREEN.r, GREEN.g, GREEN.b, 255]);
  });

  it("forgets nothing for rows outside it, and everything on a reset", () => {
    const overlay = new TuftOverlay(BOUNDS);
    overlay.stamp(0, 7, [{ cloud: blade, x: 0, y: 0 }]);
    overlay.forget(-20, -10);
    expect(overlay.holds(0, 7)).toBe(true);
    overlay.reset();
    expect(overlay.holds(0, 7)).toBe(false);
    expect(over(overlay, ...texel(0, 7, 0, -3))).toEqual([0, 0, 0, 255]);
  });
});
