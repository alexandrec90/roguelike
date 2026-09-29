/**
 * A flame's body, as a heat field advected up a small grid.
 *
 * The torch this replaces was three hand-drawn frames, and a drawn flame has
 * exactly the problem `procedural-effects.md` names: it is one flame. This is
 * the automaton the rule asks for instead — the classic demoscene fire, with the
 * one refinement that makes it look like flame rather than static:
 *
 * - **Heat rises.** Every tick, each cell takes a weighted average of the cells
 *   below it, so heat is carried up one row per tick and blurred sideways as it
 *   goes. The blur is what makes a flame narrow toward its tip: heat that spreads
 *   into a column with no fuel under it is heat that never comes back.
 * - **The cooling map rises with it.** Each cell loses heat by a smooth noise
 *   field that scrolls upward at exactly the speed the heat does (Hugo Elias's
 *   trick). A cool patch therefore travels *with* the flame instead of flickering
 *   in place, so it carves a gap that climbs — and a gap that climbs is a tongue
 *   breaking off the top of the fire, which is the thing that makes a flame read
 *   as alive rather than as a gradient that twitches.
 * - **Fuel feeds the bottom.** Two hidden rows under the visible grid are set
 *   from a fuel profile each tick, wobbled by noise and the odd seeded spark, so
 *   the base surges and ebbs.
 *
 * Wind leans it: a cell samples the column upwind of itself with a probability
 * that grows with height, so a gust bends the tip and leaves the base rooted.
 *
 * Deterministic: stepped in fixed ticks from a clamped delta, every draw is
 * `pixelHash` or seeded noise over (cell, tick), so the same flame stepped by the
 * same deltas makes the same pixels in the lab and in the game. Sized by its
 * spec, so a campfire, a brazier and a strip of burning grass are one mechanism.
 */

import type { InkId, PixelCloud } from "../ink";
import { rampSlice } from "../palette";
import { fbm3, valueNoise2 } from "../procgen/noise";
import { rampInk } from "../shading";
import { pixelHash } from "../transforms";

/**
 * The fire ramp without its coals: tips a deep red-orange, the core near white.
 * The two darkest steps read as a dark hood over the flame by daylight.
 */
export const FLAME_RAMP: readonly InkId[] = rampSlice("fire", 2, 6);

/** Hidden rows under the visible grid that the fuel is written into. */
const SOURCE_ROWS = 2;

/** The most ticks one call will run — a backgrounded tab must not burn for a minute. */
const MAX_TICKS_PER_STEP = 6;

export interface FlameSpec {
  /** Grid size in cells, which are logical pixels. */
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  /**
   * Fuel per column, 0..1. The default is a hump in the middle — a campfire;
   * a flat run is burning ground, two humps a brazier with a gap.
   */
  readonly fuel?: (column: number, width: number) => number;
  /** How long one tick of the automaton is. Shorter rises faster. */
  readonly tickMs?: number;
  /**
   * Mean heat lost per row, before the noise. Around `1 / height` lets the
   * hottest heat just reach the top row; more keeps the flame low.
   */
  readonly cooling?: number;
  /** How hard the rising cool patches bite. 0 is a smooth, dead cone. */
  readonly lick?: number;
}

export interface Flame {
  readonly spec: Required<Omit<FlameSpec, "fuel">> & Pick<FlameSpec, "fuel">;
  /** `(height + SOURCE_ROWS) * width` cells, row 0 at the top. */
  heat: Float32Array;
  scratch: Float32Array;
  /** Ticks run so far — the clock the cooling map scrolls on. */
  tick: number;
  /** Delta not yet spent on a whole tick. */
  carryMs: number;
}

export interface FlameDrive {
  /** Signed sideways wind, about -1..1. */
  readonly wind?: number;
  /** Fuel multiplier, 0..1+. Rain damps a fire; a gust of air feeds it. */
  readonly intensity?: number;
}

/** A centred hump of fuel, full across the middle half and falling off at the ends. */
export function humpFuel(column: number, width: number): number {
  const across = Math.abs((column + 0.5) / width - 0.5) * 2;
  return Math.max(0, 1 - across ** 2.2) * (across < 0.85 ? 1 : 0.4);
}

export function createFlame(spec: FlameSpec): Flame {
  if (!Number.isInteger(spec.width) || !Number.isInteger(spec.height) || spec.width < 3 || spec.height < 3) {
    throw new Error("A flame needs an integer grid of at least 3x3");
  }
  const tickMs = spec.tickMs ?? 30;
  if (!(tickMs > 0)) {
    throw new Error("A flame's tick must be longer than zero");
  }
  const cells = spec.width * (spec.height + SOURCE_ROWS);
  return {
    spec: {
      width: spec.width,
      height: spec.height,
      seed: spec.seed,
      fuel: spec.fuel,
      tickMs,
      cooling: spec.cooling ?? 0.8 / spec.height,
      lick: spec.lick ?? 1.6,
    },
    heat: new Float32Array(cells),
    scratch: new Float32Array(cells),
    tick: 0,
    carryMs: 0,
  };
}

/**
 * Advance the flame by a real delta. Whole ticks only; the remainder carries.
 *
 * The delta is clamped to a few ticks' worth, so a hitch costs a missed beat of
 * flicker rather than a fire that visibly fast-forwards.
 */
export function stepFlame(flame: Flame, deltaMs: number, drive: FlameDrive = {}): void {
  const tickMs = flame.spec.tickMs;
  flame.carryMs = Math.min(flame.carryMs + Math.max(deltaMs, 0), tickMs * MAX_TICKS_PER_STEP);
  while (flame.carryMs >= tickMs) {
    flame.carryMs -= tickMs;
    tickFlame(flame, drive);
  }
}

/** Run a new flame for a while so it does not start as a cold grid. */
export function settleFlame(flame: Flame, ms: number, drive: FlameDrive = {}): void {
  const ticks = Math.floor(ms / flame.spec.tickMs);
  for (let index = 0; index < ticks; index += 1) {
    tickFlame(flame, drive);
  }
}

function feed(flame: Flame, intensity: number): void {
  const { width, height, seed } = flame.spec;
  const fuel = flame.spec.fuel ?? humpFuel;
  const tick = flame.tick;
  for (let row = height; row < height + SOURCE_ROWS; row += 1) {
    for (let x = 0; x < width; x += 1) {
      // A slow surge along the base, plus the odd hot spark that climbs as a
      // bright fleck — the two things a real fire's base does.
      const surge = 0.5 + 0.62 * valueNoise2(x * 0.7, tick * 0.18, seed + 3) ** 1.5;
      const spark = pixelHash(x, tick * 3 + row, seed, 11) > 0.93 ? 0.35 : 0;
      flame.heat[row * width + x] = Math.min(1.2, (fuel(x, width) * surge + spark) * intensity);
    }
  }
}

/** One tick: feed the base, then every visible cell takes heat from below. */
function tickFlame(flame: Flame, drive: FlameDrive): void {
  flame.tick += 1;
  feed(flame, Math.max(drive.intensity ?? 1, 0));
  const { width, height } = flame.spec;
  const wind = Math.min(Math.max(drive.wind ?? 0, -1), 1);
  const heat = flame.heat;
  const next = flame.scratch;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = x - lean(flame, x, y, wind);
      const rise = sample(heat, width, from, y + 1);
      const spread = sample(heat, width, from - 1, y + 1) + sample(heat, width, from + 1, y + 1);
      const deep = sample(heat, width, from, y + 2);
      const carried = (rise * 2.6 + spread * 0.7 + deep) / 5;
      next[y * width + x] = Math.max(0, carried - coolingAt(flame, x, y));
    }
  }
  // Only the visible rows were rewritten; the source rows are re-fed next tick.
  heat.set(next.subarray(0, width * height));
}

function sample(heat: Float32Array, width: number, x: number, y: number): number {
  if (x < 0 || x >= width) {
    return 0;
  }
  return heat[y * width + x] ?? 0;
}

/**
 * Which way this cell reaches for its heat: -1, 0 or +1 columns.
 *
 * Wind is a probability that grows toward the tip, so the base stays planted
 * and the top bends. A little seeded turbulence on top keeps a still flame from
 * rising as a perfect symmetrical cone.
 */
function lean(flame: Flame, x: number, y: number, wind: number): number {
  const { height, seed } = flame.spec;
  const up = 1 - y / height;
  const roll = pixelHash(x, y + flame.tick * 64, seed, 5);
  const pull = Math.abs(wind) * (0.15 + 0.6 * up);
  if (roll < pull) {
    return Math.sign(wind);
  }
  const jitter = pixelHash(x, y + flame.tick * 64, seed, 6);
  if (jitter < 0.08) {
    return -1;
  }
  return jitter > 0.92 ? 1 : 0;
}

/**
 * Heat lost at a cell this tick: the base rate, plus the rising noise that tears
 * tongues off the top.
 *
 * Sampled at `y + tick` so the map climbs one row per tick, in step with the
 * heat — a cool patch stays with the part of the flame it is eating.
 */
function coolingAt(flame: Flame, x: number, y: number): number {
  const { cooling, lick, seed, height } = flame.spec;
  const grain = Math.max(1, flame.spec.width / 12);
  const noise = fbm3(x / (2.2 * grain), (y + flame.tick) / (3.4 * grain), flame.tick / 40, seed + 29, {
    octaves: 2,
  });
  const bite = Math.max(0, noise - 0.42) * 2.2;
  // Bite harder toward the top: the base is solid, the tip is where it breaks.
  const up = 1 - y / height;
  const tipward = 0.35 + 0.65 * up;
  // The silhouette: heat that has strayed from the middle column cools faster
  // the higher it is, which draws the sides in to a point.
  const across = (x + 0.5) / flame.spec.width - 0.5;
  const taper = across * across * 4 * up * 2.4;
  return cooling * (1 + lick * bite * tipward * 1.8 + taper);
}

/** Heat of a visible cell, 0 outside the grid. */
export function flameHeat(flame: Flame, x: number, y: number): number {
  const { width, height } = flame.spec;
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return 0;
  }
  return flame.heat[y * width + x] ?? 0;
}

export interface FlameCloudOptions {
  readonly ramp?: readonly InkId[];
  /** Heat below this is air. Raising it thins the flame into separate tongues. */
  readonly threshold?: number;
  /** Heat at which the ramp tops out at its core ink. */
  readonly whiteHeat?: number;
}

/**
 * The flame as lit pixels, foot-anchored: (0, 0) is the middle of its base,
 * and it rises into negative y.
 *
 * Heat maps onto the ramp through the Bayer dither, so the core is a solid
 * white-yellow, the body a dithered orange, and the thin tips dark red; below
 * the threshold is nothing at all, which is what lets a torn-off lick float free.
 */
export function flameCloud(flame: Flame, options: FlameCloudOptions = {}): PixelCloud {
  const ramp = options.ramp ?? FLAME_RAMP;
  const threshold = options.threshold ?? 0.1;
  const whiteHeat = options.whiteHeat ?? 0.8;
  const { width, height } = flame.spec;
  const left = -Math.floor(width / 2);
  const cloud: PixelCloud = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const heat = flame.heat[y * width + x] ?? 0;
      if (heat <= threshold) {
        continue;
      }
      const px = left + x;
      const py = y - (height - 1);
      const level = (heat - threshold) / Math.max(whiteHeat - threshold, 1e-6);
      cloud.push({ x: px, y: py, ink: rampInk(ramp, banded(level, ramp.length), { x: px, y: py }) });
    }
  }
  return cloud;
}

/**
 * Pull a level toward the centres of its ramp steps.
 *
 * A heat field dithered straight onto a ramp reads as static: every cell sits
 * between two steps and the Bayer pattern shows everywhere. Painted flame is
 * flat bands of colour with a narrow dithered seam between them, so the
 * fraction between steps is steepened and only the middle of it dithers.
 */
export function banded(level: number, steps: number): number {
  if (steps < 2) {
    return level;
  }
  const scaled = Math.min(Math.max(level, 0), 1) * (steps - 1);
  const base = Math.floor(scaled);
  const seam = Math.min(Math.max((scaled - base - 0.5) * 2.6 + 0.5, 0), 1);
  return Math.min((base + seam) / (steps - 1), 1);
}

/** How much of the flame is alight, 0..1 — for a light's intensity or a smoke rate. */
export function flameStrength(flame: Flame): number {
  const { width, height } = flame.spec;
  let total = 0;
  for (let index = 0; index < width * height; index += 1) {
    total += Math.min(flame.heat[index] ?? 0, 1);
  }
  return total / (width * height);
}
