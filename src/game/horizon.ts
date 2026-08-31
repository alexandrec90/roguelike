/**
 * The strip at the top of the screen where the world rolls over the horizon.
 *
 * The playfield is affine and perfectly flat (see `projection.ts`). That is the
 * right camera for a turn-based grid — a tile reads the same wherever it sits —
 * but a flat plane that simply stops at the top edge of the screen reads as a
 * cropped floor, not as outdoors. So the top slice of the frame is given over
 * to the world curving away: a few scanlines of ground compressed into nothing,
 * a horizon line, sky above it, and distant silhouettes standing on it.
 *
 * The split is one number, `skyFraction`, and everything else is derived:
 *
 *     +---------------------------+  y = 0
 *     |  sky + distant objects    |  skyHeight
 *     +---------------------------+  y = horizonY   <- the horizon line
 *     |  roll (ground compressed) |  rollHeight
 *     +===========================+  y = groundTop
 *     |                           |
 *     |  flat playfield, affine   |  groundHeight
 *     |                           |
 *     +---------------------------+  y = height
 *
 * `bandHeight = skyHeight + rollHeight` is the fraction of the screen that is
 * *not* flat. At the default 0.05 on a 180px target that is 9 pixels: 6 of sky
 * and 3 of roll. Nothing in the playfield changes when it moves, which is the
 * point — the split is a framing decision, not a projection one, and it is
 * meant to be retuned by eye.
 */

import { mixHex, sampleRamp } from "./color";

/** Share of the screen height given to sky plus roll. */
export const DEFAULT_SKY_FRACTION = 0.05;

/**
 * Past this the "flat playfield with a sliver of sky" read is gone and it is a
 * different camera, so the knob refuses rather than silently producing one.
 */
export const MAX_SKY_FRACTION = 0.5;

/** How much of the band is ground curving away rather than open sky. */
export const ROLL_SHARE = 1 / 3;

/** World rows folded into the roll. They compress, so most land on no pixel. */
export const ROLL_ROWS = 12;

export interface HorizonLayout {
  /** Logical height of the whole render target. */
  readonly height: number;
  /** The fraction actually used, after clamping. */
  readonly skyFraction: number;
  /** Scanlines of open sky, from y = 0. */
  readonly skyHeight: number;
  /** Scanlines of ground rolling away, immediately below the sky. */
  readonly rollHeight: number;
  /** skyHeight + rollHeight — the whole non-flat band. */
  readonly bandHeight: number;
  /** y of the horizon line: the base distant objects stand on. */
  readonly horizonY: number;
  /** First scanline of the flat playfield. */
  readonly groundTop: number;
  /** Scanlines of flat playfield. */
  readonly groundHeight: number;
}

/**
 * Split a render target into band and playfield.
 *
 * A non-zero fraction always yields at least one scanline of each, so the
 * horizon never degenerates into sky with no roll (or the reverse) and then
 * quietly render nothing.
 */
export function horizonLayout(
  height: number,
  skyFraction: number = DEFAULT_SKY_FRACTION,
): HorizonLayout {
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error("Render height must be a positive number");
  }

  const clamped = clampFraction(skyFraction);
  const bandHeight =
    clamped === 0 ? 0 : Math.min(Math.max(Math.round(height * clamped), 2), Math.floor(height / 2));
  const rollHeight =
    bandHeight === 0 ? 0 : Math.min(Math.max(Math.round(bandHeight * ROLL_SHARE), 1), bandHeight - 1);
  const skyHeight = bandHeight - rollHeight;

  return {
    height,
    skyFraction: clamped,
    skyHeight,
    rollHeight,
    bandHeight,
    horizonY: skyHeight,
    groundTop: bandHeight,
    groundHeight: height - bandHeight,
  };
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(value, MAX_SKY_FRACTION);
}

/**
 * Read the split off a query string, so it can be retuned in the address bar
 * instead of in a rebuild. Accepts `0.08` or `8%`; anything unreadable falls
 * back rather than throwing, because a typo in a URL should not blank the game.
 */
export function parseSkyFraction(
  raw: string | null | undefined,
  fallback: number = DEFAULT_SKY_FRACTION,
): number {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const text = raw.trim();
  const percent = text.endsWith("%");
  const value = Number.parseFloat(percent ? text.slice(0, -1) : text);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return clampFraction(percent ? value / 100 : value);
}

export interface RollBand {
  /** World rows beyond the playfield; 0 is the nearest, at the roll's foot. */
  readonly row: number;
  /** Screen y of the band's top scanline. */
  readonly y: number;
  /** Always at least 1 — rows that compress to nothing are dropped. */
  readonly height: number;
}

/**
 * The scanlines of the roll, near-first.
 *
 * Distance above the playfield follows a circular ease, `sqrt(1 - (1 - u)^2)`:
 * steep at the near edge, flat at the horizon. That is the profile of a surface
 * curving away from you, and it is why a dozen world rows land on three
 * scanlines rather than three rows landing on one each. Rows that round to zero
 * height are dropped instead of being clamped to one, so the band never draws
 * more scanlines than it has.
 */
export function rollBands(rollHeight: number, rows: number = ROLL_ROWS): readonly RollBand[] {
  if (rollHeight <= 0 || rows <= 0) {
    return [];
  }

  const edge = (index: number): number => {
    const u = index / rows;
    return Math.round(rollHeight * Math.sqrt(1 - (1 - u) ** 2));
  };

  const bands: RollBand[] = [];
  for (let row = 0; row < rows; row += 1) {
    const near = edge(row);
    const far = edge(row + 1);
    if (far > near) {
      bands.push({ row, y: rollHeight - far, height: far - near });
    }
  }
  return bands;
}

/** Zenith to horizon: pitch black, with the faintest glow where ground meets sky. */
export const SKY_RAMP: readonly string[] = [
  "#000000",
  "#000000",
  "#000000",
  "#02020c",
  "#0a1024",
];

export interface ScanBand {
  readonly y: number;
  readonly height: number;
  readonly color: string;
}

/** One band per scanline: at these heights an exact ramp costs nothing. */
export function skyBands(skyHeight: number, ramp: readonly string[] = SKY_RAMP): readonly ScanBand[] {
  if (skyHeight <= 0) {
    return [];
  }
  const last = Math.max(skyHeight - 1, 1);
  return Array.from({ length: skyHeight }, (_unused, y) => ({
    y,
    height: 1,
    color: sampleRamp(ramp, y / last),
  }));
}

/** Horizon haze: black ground fading into the glow at the horizon line. */
export const ROLL_NEAR_COLOR = "#04120b";
export const ROLL_FAR_COLOR = "#0d1830";

/**
 * Colour the roll's scanlines, given the bands `rollBands` produced.
 *
 * Keyed on the world row rather than the band index, so dropping a compressed
 * row does not make the surviving ones jump a step in the gradient.
 */
export function rollColors(
  bands: readonly RollBand[],
  rows: number = ROLL_ROWS,
  near: string = ROLL_NEAR_COLOR,
  far: string = ROLL_FAR_COLOR,
): readonly ScanBand[] {
  const span = Math.max(rows - 1, 1);
  return bands.map((band) => ({
    y: band.y,
    height: band.height,
    color: mixHex(near, far, band.row / span),
  }));
}

export interface RidgeOptions {
  readonly seed?: number;
  /** Scanlines the ridge rises above the horizon at its mean. */
  readonly base?: number;
  readonly amplitude?: number;
  /** Screen pixels per noise cell; larger is smoother. */
  readonly wavelength?: number;
  /** Nothing may poke out of the top of the sky band. */
  readonly maxHeight?: number;
}

function hashUnit(cell: number, seed: number): number {
  let h = Math.imul(cell ^ seed, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 0xffffffff;
}

function smoothNoise(x: number, seed: number): number {
  const cell = Math.floor(x);
  const f = x - cell;
  const s = f * f * (3 - 2 * f);
  return hashUnit(cell, seed) * (1 - s) + hashUnit(cell + 1, seed) * s;
}

/**
 * Height above the horizon line, per screen column, for the distant ridge.
 *
 * Seeded value noise rather than authored pixels: this is background mass at
 * one or two pixels of relief, where the art contract's "author the silhouette"
 * rule buys nothing and a seed buys a ridge that is identical in every capture.
 * Anything with an identity — a tower, a stand of pines — is authored art drawn
 * on top of it.
 */
export function ridgeProfile(width: number, options: RidgeOptions = {}): readonly number[] {
  const {
    seed = 1337,
    base = 2,
    amplitude = 3,
    wavelength = 34,
    maxHeight = Number.POSITIVE_INFINITY,
  } = options;

  if (width < 0) {
    throw new Error("Ridge width cannot be negative");
  }
  if (wavelength <= 0) {
    throw new Error("Ridge wavelength must be positive");
  }

  return Array.from({ length: width }, (_unused, x) => {
    const coarse = smoothNoise(x / wavelength, seed);
    const fine = smoothNoise((x / wavelength) * 2.7, seed + 1);
    const raw = base + amplitude * (0.68 * coarse + 0.32 * fine);
    return Math.max(0, Math.min(Math.round(raw), maxHeight));
  });
}

export interface Star {
  readonly x: number;
  readonly y: number;
  /** A few stars are bright white; the rest are dim. */
  readonly bright: boolean;
}

/**
 * Seeded stars for the black sky band. Deterministic per (size, seed), so a
 * capture of the sky is comparable across runs; density is per pixel, so
 * squeezing the band keeps the sky equally starry rather than equally counted.
 */
export function starField(
  width: number,
  skyHeight: number,
  seed = 977,
  density = 0.015,
): readonly Star[] {
  const stars: Star[] = [];
  for (let y = 0; y < skyHeight; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const roll = hashUnit(x + y * width, seed);
      if (roll < density) {
        stars.push({ x, y, bright: hashUnit(x + y * width, seed ^ 0x51ed270b) < 0.25 });
      }
    }
  }
  return stars;
}
