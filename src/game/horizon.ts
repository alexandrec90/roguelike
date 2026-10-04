/**
 * The strip at the top of the screen where the world rolls over the horizon.
 *
 * The playfield is affine and perfectly flat (see `projection.ts`). That is the
 * right camera for a tile grid — a tile reads the same wherever it sits —
 * but a flat plane that simply stops at the top edge of the screen reads as a
 * cropped floor, not as outdoors. So the top slice of the frame is given over
 * to the world curving away: the lip of a treadmill, where the flat field bends
 * over and its rows compress into nothing, a horizon line, sky above it, and
 * distant silhouettes standing on it.
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
 * *not* flat. At the default 0.22 on a 180px target that is 40 pixels: 16 of
 * sky and 24 of roll. Nothing in the playfield changes when it moves, which is the
 * point — the split is a framing decision, not a projection one, and it is
 * meant to be retuned by eye.
 *
 * The band is a *place*, not a backdrop. Anything standing in the field is
 * drawn over it, so a tree on the far row keeps its crown against the sky, and
 * the world past the field is projected onto the roll by `rollPlacement`:
 * `ROLL_ROWS` rows of it, each a little higher and a little smaller, until the
 * horizon line, past which it has curved out of sight. The roll meets the
 * field without a crease — its first row is as tall as a flat one — which is
 * why it needs two dozen scanlines rather than the seven a hard fold got by on. What is on the horizon
 * is therefore real — walk toward it and it grows and comes down onto the field.
 */

import { sampleRamp } from "./color";
import { TILE_DEPTH } from "./projection";

/**
 * Share of the screen height given to sky plus roll.
 *
 * The sky's share of it has to hold a tree standing on the horizon line, drawn
 * at `HORIZON_SCALE` of its height, with its crown on screen - about fifteen
 * scanlines. The roll's share has to hold the lip: it starts at the flat
 * field's full row height and eases off, so anything under about two rows'
 * worth of scanlines bends too tightly to read as a curve and reads as a fold
 * again. Twenty-two percent gives both. Retune it by eye with `?horizon=`.
 */
export const DEFAULT_SKY_FRACTION = 0.22;

/**
 * Past this the "flat playfield with a sliver of sky" read is gone and it is a
 * different camera, so the knob refuses rather than silently producing one.
 */
export const MAX_SKY_FRACTION = 0.5;

/** How much of the band is ground curving away rather than open sky. */
export const ROLL_SHARE = 0.6;

/**
 * World rows beyond the flat field before the ground has curved out of sight.
 *
 * This is the distance to the horizon, and the horizon is *real*: a tree this
 * many rows past the field's far edge stands on the horizon line, one row
 * nearer stands a fraction of a scanline below it and a fraction larger, and a
 * row further is gone over the curve. Walk toward it and it grows and comes
 * down the lip onto the flat field. The ground folds the same rows into the
 * roll's scanlines (`roll-ground.ts`), so what a body stands on and where it is
 * drawn come from one curve.
 */
export const ROLL_ROWS = 48;

/**
 * How large a thing standing on the horizon line is drawn, as a share of its
 * full size. Sets how hard the far end of the roll shrinks; the near end is
 * always 1 so the seam with the flat field is invisible.
 */
export const HORIZON_SCALE = 0.18;

/**
 * The roll is the lip of a treadmill: the belt runs perfectly flat, then bends
 * over the drum and out of sight.
 *
 * What that means in pixels is that the lip starts with the flat field's own
 * slope - one row past the seam is `TILE_DEPTH` scanlines tall, exactly like
 * the row before it - and eases off from there, so there is no crease where
 * the field stops and the curve begins. A row `r` past the seam is
 * `TILE_DEPTH / (1 + (r / knee)²)` scanlines tall: flat at the seam (the
 * compression starts with zero slope), steepest around the knee, and a long
 * tail that folds the last few dozen rows into the scanlines under the
 * horizon line. Its integral is an arctangent, which is `rollLift`.
 *
 * The knee is not a knob. Matching the flat field's slope *and* landing
 * `ROLL_ROWS` out on the horizon line fixes it once the roll's height is
 * known, so a taller roll is a gentler lip and a shorter one a tighter bend.
 */
export function rollKnee(rollHeight: number, rows: number = ROLL_ROWS): number {
  if (rollHeight <= 0 || rows <= 0) {
    return 0;
  }
  // A number, not a string: this is asked several times per scanline of the
  // lip and per step of a landform's march, and building a key was the cost.
  const key = rollHeight * 4096 + rows;
  const cached = knees.get(key);
  if (cached !== undefined) {
    return cached;
  }
  // `k · atan(rows / k)` climbs from 0 toward `rows` as the knee widens, so a
  // bisection always lands. A roll taller than the rows could ever fill at the
  // flat field's slope has no lip at all; it saturates at the widest knee.
  const target = Math.min(rollHeight / TILE_DEPTH, rows * 0.999);
  let low = 0;
  let high = rows * 1000;
  for (let step = 0; step < 64; step += 1) {
    const mid = (low + high) / 2;
    if (mid * Math.atan(rows / mid) < target) {
      low = mid;
    } else {
      high = mid;
    }
  }
  const knee = (low + high) / 2;
  knees.set(key, knee);
  return knee;
}

const knees = new Map<number, number>();

/**
 * How far up the roll a row `rowsBeyond` the field lands, 0 at the seam and 1
 * at the horizon line. Past the horizon it keeps climbing, so a caller can
 * tell "on the line" from "over it".
 */
export function rollLift(rowsBeyond: number, rollHeight: number, rows: number = ROLL_ROWS): number {
  if (rowsBeyond <= 0) {
    return 0;
  }
  const knee = rollKnee(rollHeight, rows);
  if (knee === 0) {
    return 1;
  }
  return Math.atan(rowsBeyond / knee) / Math.atan(rows / knee);
}

/** The inverse of `rollLift`: which row past the seam a share of the roll shows. */
export function rollRowAt(lift: number, rollHeight: number, rows: number = ROLL_ROWS): number {
  const knee = rollKnee(rollHeight, rows);
  if (lift <= 0 || knee === 0) {
    return 0;
  }
  return knee * Math.tan(Math.min(lift, 1) * Math.atan(rows / knee));
}

/**
 * Size of a body `rowsBeyond` rows past the field's far edge, 1..`horizonScale`.
 *
 * Perspective's own relation: a thing's size goes as the square root of how
 * hard the ground under it is squashed, renormalised so the curve is exactly
 * 1 at the seam and exactly `horizonScale` on the horizon line. Because the
 * squash starts with zero slope, so does the shrink - a tree walking off the
 * field keeps its size for the first stretch of the lip and only then starts
 * to recede. Nothing in the flat field shrinks; this is the one place the
 * projection is allowed to make a thing smaller for being far away.
 */
export function rollScale(
  rowsBeyond: number,
  rollHeight: number,
  rows: number = ROLL_ROWS,
  horizonScale: number = HORIZON_SCALE,
): number {
  if (rowsBeyond <= 0 || rows <= 0) {
    return 1;
  }
  if (rowsBeyond > rows) {
    // Over the horizon a thing keeps receding: size falls as one over distance,
    // from exactly `horizonScale` on the line, so nothing jumps as it crosses.
    return (horizonScale * rows) / rowsBeyond;
  }
  const knee = rollKnee(rollHeight, rows);
  if (knee === 0) {
    return horizonScale;
  }
  const squash = (row: number): number => 1 / (1 + (row / knee) ** 2);
  const far = squash(rows);
  const share = Math.max(0, (squash(rowsBeyond) - far) / (1 - far));
  return horizonScale + (1 - horizonScale) * Math.sqrt(share);
}

/**
 * How fast the world past the horizon sinks behind the curve: pixels of a
 * body's height hidden below the horizon line, per row past it, squared.
 *
 * The planet is round, so what is past the horizon is not gone - it is below
 * the line, foot first. A tree a dozen rows over has sunk out of sight; a
 * mountain shows its peak forty rows past the line and rises as it is
 * approached. Steep enough that the far bodies in view stay a few dozen - each
 * one is a slot and a bake - and shallow enough that the tallest landform is
 * on the skyline from twice the horizon's distance.
 */
export const HORIZON_SINK_RATE = 0.25;

/** Rows past the horizon line by which a body this tall, in pixels at full size, has sunk from sight. */
export function rowsToSink(height: number, rows: number = ROLL_ROWS): number {
  return rows + Math.sqrt(Math.max(height, 0) / HORIZON_SINK_RATE);
}

/** Pixels of a body's height, at full size, hidden below the horizon line. */
export function horizonSink(rowsBeyond: number, rows: number = ROLL_ROWS): number {
  const over = rowsBeyond - rows;
  return over <= 0 ? 0 : HORIZON_SINK_RATE * over * over;
}

export interface RollPlacement {
  /** Fraction of the roll's height above the field's far edge, 0..1. */
  readonly lift: number;
  /** Size relative to a body in the flat field: 1 at the seam, `HORIZON_SCALE` on the line, less past it. */
  readonly scale: number;
  /** Past the horizon line: drawn sunk by `sink` and cut off at the line. */
  readonly beyond: boolean;
  /** Pixels of height, at full size, hidden below the horizon line; 0 this side of it. */
  readonly sink: number;
}

/** Where a row past the field's far edge lands on a roll this tall, and how large. */
export function rollPlacement(
  rowsBeyond: number,
  rollHeight: number,
  rows: number = ROLL_ROWS,
): RollPlacement {
  return {
    lift: Math.min(rollLift(rowsBeyond, rollHeight, rows), 1),
    scale: rollScale(rowsBeyond, rollHeight, rows),
    beyond: rowsBeyond > rows,
    sink: horizonSink(rowsBeyond, rows),
  };
}

/**
 * How far into the flat field a foot at scanline `footY` stands: 0 at the
 * seam and anywhere on the roll, rising to 1 one row in.
 *
 * What a body does only on the field - lean with the wind, cast a shadow - is
 * scaled by this, so it has faded out by the time the body reaches the roll.
 * A body there is drawn from its horizon ladder, upright and shadowless, and
 * without the fade it would snap between the two pictures on the frame it
 * crossed the seam.
 */
export function fieldDepth(footY: number, groundTop: number): number {
  return Math.min(Math.max((footY - groundTop) / TILE_DEPTH, 0), 1);
}

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

export interface RidgeOptions {
  readonly seed?: number;
  /** Scanlines the ridge rises above the horizon at its mean. */
  readonly base?: number;
  readonly amplitude?: number;
  /** Screen pixels per noise cell; larger is smoother. */
  readonly wavelength?: number;
  /** Nothing may poke out of the top of the sky band. */
  readonly maxHeight?: number;
  /**
   * Columns after which the profile repeats exactly, or 0 for an open one.
   *
   * The horizon of a round world is a loop: `panorama.ts` generates one turn of
   * ridge and scrolls it as the hero swings, so column `period` has to be
   * column 0 down to the pixel or the seam is a cliff that comes round once a
   * lap. Setting it folds the noise lattice modulo its own cell count, which is
   * the only place a seamless profile can come from.
   */
  readonly period?: number;
}

function hashUnit(cell: number, seed: number): number {
  let h = Math.imul(cell ^ seed, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 0xffffffff;
}

function smoothNoise(x: number, seed: number, cells = 0): number {
  const cell = Math.floor(x);
  const f = x - cell;
  const s = f * f * (3 - 2 * f);
  const at = (index: number): number =>
    hashUnit(cells > 0 ? ((index % cells) + cells) % cells : index, seed);
  return at(cell) * (1 - s) + at(cell + 1) * s;
}

/**
 * One octave of the ridge, folded into a loop when `period` asks for one.
 *
 * The lattice is re-expressed as a whole number of cells per period rather than
 * as a wavelength, because only a whole number closes. The wavelength is
 * therefore a request, honoured to within half a cell - which at ridge
 * wavelengths is a couple of pixels and invisible.
 */
function ridgeOctave(x: number, wavelength: number, seed: number, period: number): number {
  if (period <= 0) {
    return smoothNoise(x / wavelength, seed);
  }
  const cells = Math.max(1, Math.round(period / wavelength));
  return smoothNoise((x / period) * cells, seed, cells);
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
    period = 0,
  } = options;

  if (width < 0) {
    throw new Error("Ridge width cannot be negative");
  }
  if (wavelength <= 0) {
    throw new Error("Ridge wavelength must be positive");
  }

  return Array.from({ length: width }, (_unused, x) => {
    const coarse = ridgeOctave(x, wavelength, seed, period);
    const fine = ridgeOctave(x, wavelength / 2.7, seed + 1, period);
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
