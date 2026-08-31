/**
 * The 1-bit ink system: every drawable is lit pixels on pitch black.
 *
 * The art direction is a black field with high-contrast neon marks on it, and
 * this module is the type that direction compiles to. A **pixel cloud** is an
 * ordered list of lit logical pixels, each carrying one ink from a small named
 * set. Everything renderable — a rigged character, a sword, a melting corpse, a
 * reflection in a puddle — flattens to a cloud before it reaches the screen,
 * which is what lets one generic transform (melt, freeze, burn) apply to any
 * model instead of needing per-model frames.
 *
 * Order matters: later pixels overwrite earlier ones when a cloud is flattened
 * to a sprite, so a renderer draws far things first and near things last and
 * gets painter's-algorithm self-occlusion for free.
 *
 * Inks are a closed set on purpose. An agent drawing a new asset picks an ink
 * by name; it cannot invent a hex value, so the scene cannot drift off the
 * palette one asset at a time.
 */

import type { Palette, PixelSpriteSource } from "./pixel-art";

/** The screen behind everything. Pitch black, not "very dark". */
export const BACKGROUND = "#000000";

export type InkId =
  | "bone"
  | "neon-green"
  | "cyan"
  | "magenta"
  | "amber"
  | "ember"
  | "ice"
  | "violet"
  | "steel"
  | "deep"
  | "void";

/**
 * The palette. `void` is deliberate black: on a black background it reads as a
 * hole, which is how eyes and hollows are punched into a lit silhouette.
 */
export const INK_COLORS: Readonly<Record<InkId, string>> = {
  bone: "#f2f7ff",
  "neon-green": "#3cf06e",
  cyan: "#35e8ff",
  magenta: "#ff44e0",
  amber: "#ffc23a",
  ember: "#ff5a2b",
  ice: "#a8ecff",
  violet: "#a06bff",
  steel: "#5e7ea6",
  deep: "#1d4d6b",
  void: "#000000",
};

/** Stable one-character palette tokens, so flattened sprites diff cleanly. */
export const INK_TOKENS: Readonly<Record<InkId, string>> = {
  bone: "w",
  "neon-green": "g",
  cyan: "c",
  magenta: "m",
  amber: "a",
  ember: "e",
  ice: "i",
  violet: "v",
  steel: "s",
  deep: "d",
  void: "k",
};

export interface InkPixel {
  readonly x: number;
  readonly y: number;
  readonly ink: InkId;
}

/** Ordered lit pixels; later entries win when flattened. Mutated in place by the draw helpers. */
export type PixelCloud = InkPixel[];

export interface Mask {
  readonly width: number;
  readonly height: number;
  /** Offsets of lit pixels from the mask's top-left. */
  readonly pixels: readonly { readonly x: number; readonly y: number }[];
}

/**
 * Parse a text mask: `#` lit, `.` empty. Masks carry shape only — the ink is
 * chosen where the mask is stamped, so one hat mask can be any colour.
 */
export function maskFromRows(rows: readonly string[]): Mask {
  const first = rows[0];
  if (first === undefined || first.length === 0) {
    throw new Error("A mask needs at least one pixel");
  }

  const pixels: { x: number; y: number }[] = [];
  rows.forEach((row, y) => {
    if (row.length !== first.length) {
      throw new Error(`Mask row ${y} has width ${row.length}; expected ${first.length}`);
    }
    Array.from(row).forEach((glyph, x) => {
      if (glyph === "#") {
        pixels.push({ x, y });
      } else if (glyph !== ".") {
        throw new Error(`Mask glyph '${glyph}' at ${x},${y}; use '#' or '.'`);
      }
    });
  });

  return { width: first.length, height: rows.length, pixels };
}

export function mirrorMask(mask: Mask): Mask {
  return {
    width: mask.width,
    height: mask.height,
    pixels: mask.pixels.map((pixel) => ({ x: mask.width - 1 - pixel.x, y: pixel.y })),
  };
}

/** Stamp a mask with its top-left at (x, y). */
export function stampMask(cloud: PixelCloud, mask: Mask, x: number, y: number, ink: InkId): void {
  for (const pixel of mask.pixels) {
    cloud.push({ x: x + pixel.x, y: y + pixel.y, ink });
  }
}

/**
 * Bresenham line between two logical pixels, inclusive of both ends.
 *
 * `thickness` is a square brush centred on the line — 2 is the widest anything
 * on a 16px-tall character should ever need.
 */
export function strokeLine(
  cloud: PixelCloud,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  ink: InkId,
  thickness = 1,
): void {
  if (!Number.isInteger(thickness) || thickness < 1) {
    throw new Error("Stroke thickness must be a positive integer");
  }
  const lo = -Math.floor((thickness - 1) / 2);
  const hi = Math.ceil((thickness - 1) / 2);

  let x = Math.round(from.x);
  let y = Math.round(from.y);
  const endX = Math.round(to.x);
  const endY = Math.round(to.y);
  const dx = Math.abs(endX - x);
  const dy = -Math.abs(endY - y);
  const stepX = x < endX ? 1 : -1;
  const stepY = y < endY ? 1 : -1;
  let error = dx + dy;

  for (;;) {
    for (let ox = lo; ox <= hi; ox += 1) {
      for (let oy = lo; oy <= hi; oy += 1) {
        cloud.push({ x: x + ox, y: y + oy, ink });
      }
    }
    if (x === endX && y === endY) {
      break;
    }
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      y += stepY;
    }
  }
}

/** Mirror across x = 0 (the cloud's anchor column). */
export function mirrorCloud(cloud: PixelCloud): PixelCloud {
  return cloud.map((pixel) => ({ x: -pixel.x, y: pixel.y, ink: pixel.ink }));
}

export function translateCloud(cloud: PixelCloud, dx: number, dy: number): PixelCloud {
  return cloud.map((pixel) => ({ x: pixel.x + dx, y: pixel.y + dy, ink: pixel.ink }));
}

export interface CloudBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Inclusive bounds of the lit pixels, or null for an empty cloud. */
export function cloudBounds(cloud: PixelCloud): CloudBounds | null {
  const first = cloud[0];
  if (first === undefined) {
    return null;
  }
  let left = first.x;
  let right = first.x;
  let top = first.y;
  let bottom = first.y;
  for (const pixel of cloud) {
    left = Math.min(left, pixel.x);
    right = Math.max(right, pixel.x);
    top = Math.min(top, pixel.y);
    bottom = Math.max(bottom, pixel.y);
  }
  return { left, top, right, bottom };
}

export interface CloudFrame {
  readonly width: number;
  readonly height: number;
  /** Where the cloud's (0, 0) lands inside the frame. */
  readonly originX: number;
  readonly originY: number;
}

/**
 * Flatten a cloud into the text-sprite format the rest of the pipeline speaks.
 *
 * Later pixels overwrite earlier ones (painter's order). Pixels outside the
 * frame are clipped rather than thrown on: this runs per animation frame, and
 * a melt that pools one pixel wide of the box should lose that pixel, not the
 * scene. Use `cloudBounds` in a test when overflow would be a bug.
 */
export function cloudToSprite(cloud: PixelCloud, frame: CloudFrame): PixelSpriteSource {
  if (frame.width < 1 || frame.height < 1) {
    throw new Error("Cloud frame must be at least 1x1");
  }

  const grid: (InkId | null)[][] = Array.from({ length: frame.height }, () =>
    Array.from({ length: frame.width }, () => null),
  );
  for (const pixel of cloud) {
    const column = frame.originX + pixel.x;
    const row = frame.originY + pixel.y;
    if (column >= 0 && column < frame.width && row >= 0 && row < frame.height) {
      const gridRow = grid[row];
      if (gridRow !== undefined) {
        gridRow[column] = pixel.ink;
      }
    }
  }

  const palette: Record<string, string | null> = { ".": null };
  const rows = grid.map((gridRow) =>
    gridRow
      .map((ink) => {
        if (ink === null) {
          return ".";
        }
        const token = INK_TOKENS[ink];
        palette[token] = INK_COLORS[ink];
        return token;
      })
      .join(""),
  );

  return { palette: palette as Palette, rows };
}
