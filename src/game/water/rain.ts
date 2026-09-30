/**
 * Rain in depth: three sheets of drops, each falling to its own band of ground.
 *
 * The first rain was one emitter whose drops all fell the height of the screen,
 * which is right for a curtain in front of a window and wrong for weather over a
 * field seen from above. Here a drop is born knowing **where on the ground it
 * lands** — a seeded row in the playfield — and which of three sheets it belongs
 * to:
 *
 * | Sheet | Lands | Reads as |
 * | --- | --- | --- |
 * | far  | up by the horizon | short, dim, slow — rain seen through rain |
 * | mid  | the middle of the field | the body of the shower |
 * | near | the foreground | long, bright, fast streaks passing the camera |
 *
 * That one number is what makes it read as rain *on* the world rather than rain
 * *on the glass*: drops end all over the field, each in a splash, and the far
 * ones are small because they are far. It is also what makes a drop's landing a
 * depth statement, so a streak crossing a puddle on its way to the grass in
 * front of it does not ring the water.
 *
 * The wind is still one number the whole sheet agrees on — `RAIN_SLANT` in
 * `weather.ts`, scaled by the weather's wind — and a streak is drawn along its
 * drop's own velocity, so the trail always points where the drop is going.
 *
 * Pooled (a storm that runs all night has not grown), seeded through
 * `pixelHash` from a spawn counter, and stepped by clamped deltas, so the same
 * deltas make the same storm. Drawing writes straight into a `PixelBuffer`
 * rather than building a cloud per drop: three hundred streaks a frame is the
 * one place in this area where an allocation per pixel would show.
 */

import type { InkId, PixelCloud } from "../ink";
import { blendInk, type PixelBuffer } from "../pixel-buffer";
import { rampInk } from "../shading";
import { pixelHash } from "../transforms";

export type RainSheet = 0 | 1 | 2;

interface SheetSpec {
  /** Fall speed, logical px per ms. */
  readonly speed: number;
  /** Streak length in pixels, head included. */
  readonly length: number;
  /** Where it lands, as a share of the playfield below the horizon (0 far .. 1 near). */
  readonly land: readonly [number, number];
  /** Drops on screen at a rain level of 1. */
  readonly count: number;
  /** Where on the rain ramp the streak's tail and head sit, before the daylight dims them. */
  readonly tail: number;
  readonly head: number;
  /** The sheet's opacity — lighting on the whole sheet, not a colour of its own. */
  readonly alpha: number;
}

/** Far, mid, near. Tuned by eye at 1x, 320x180. */
export const RAIN_SHEETS: readonly [SheetSpec, SheetSpec, SheetSpec] = [
  { speed: 0.11, length: 3, land: [-0.02, 0.35], count: 150, tail: 0.3, head: 0.5, alpha: 0.55 },
  { speed: 0.17, length: 5, land: [0.25, 0.75], count: 100, tail: 0.4, head: 0.75, alpha: 0.68 },
  { speed: 0.25, length: 8, land: [0.6, 1.08], count: 45, tail: 0.5, head: 1, alpha: 0.8 },
];

/** Cool and pale, darkest first: rain is the sky's colour, lit. */
export const RAIN_RAMP: readonly InkId[] = [
  "water-3",
  "water-4",
  "frost-2",
  "water-5",
  "frost-3",
  "frost-4",
  "foam",
];

export interface Drop {
  active: boolean;
  sheet: RainSheet;
  x: number;
  y: number;
  /** The screen row this drop hits the ground at. */
  landY: number;
}

export interface RainField {
  readonly drops: Drop[];
  readonly seed: number;
  /** Spawns so far: the hash counter that makes every drop distinct. */
  spawned: number;
  /** Fractional drops owed to each sheet, so a low rate still spawns on time. */
  readonly owed: [number, number, number];
}

/** What the sky is doing this step, and the frame it is doing it over. */
export interface RainEnv {
  /** 0..1 — scales every sheet's density. */
  readonly rain: number;
  /** Sideways px per px fallen: `RAIN_SLANT` times the weather's wind. */
  readonly slant: number;
  readonly width: number;
  readonly height: number;
  /** Top of the flat field; the far sheet lands just above it, on the horizon roll. */
  readonly groundTop: number;
}

/** A drop that reached the ground this step: where it was, and where it hit. */
export interface Landing {
  readonly sheet: RainSheet;
  readonly fromX: number;
  readonly fromY: number;
  readonly x: number;
  readonly y: number;
}

/** The largest step the field integrates at once. */
export const MAX_RAIN_STEP_MS = 50;

export function createRainField(capacity = 420, seed = 0x1d872b41): RainField {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error("A rain field needs a positive integer capacity");
  }
  return {
    drops: Array.from({ length: capacity }, () => ({ active: false, sheet: 0, x: 0, y: 0, landY: 0 })),
    seed,
    spawned: 0,
    owed: [0, 0, 0],
  };
}

export function liveDrops(field: RainField): number {
  let count = 0;
  for (const drop of field.drops) {
    count += drop.active ? 1 : 0;
  }
  return count;
}

/** Where a sheet's drops land, in screen rows, for a given frame. */
export function landingBand(sheet: RainSheet, env: RainEnv): readonly [number, number] {
  const spec = RAIN_SHEETS[sheet];
  const field = env.height - env.groundTop;
  return [env.groundTop + spec.land[0] * field, env.groundTop + spec.land[1] * field];
}

/**
 * Launch one drop. It is aimed backward from where it will land — up the
 * slant to just above the top edge — so slanted rain covers the whole field
 * rather than leaving the upwind edge dry.
 */
function spawn(field: RainField, sheet: RainSheet, env: RainEnv): void {
  const slot = field.drops.find((drop) => !drop.active);
  field.spawned += 1;
  if (slot === undefined) {
    return;
  }
  const n = field.spawned;
  const [near, far] = landingBand(sheet, env);
  const landX = -8 + pixelHash(n, 1, field.seed) * (env.width + 16);
  const landY = near + pixelHash(n, 2, field.seed) * (far - near);
  const startY = -RAIN_SHEETS[sheet].length - pixelHash(n, 3, field.seed) * 6;
  slot.active = true;
  slot.sheet = sheet;
  slot.landY = Math.round(landY);
  slot.y = startY;
  slot.x = landX - env.slant * (slot.landY - startY);
}

/**
 * Advance the field by `deltaMs`: spawn what the rain level owes each sheet,
 * move every drop, and hand each one that reached its row to `land`.
 */
export function stepRainField(
  field: RainField,
  deltaMs: number,
  env: RainEnv,
  land: (landing: Landing) => void,
): void {
  const dt = Math.min(Math.max(deltaMs, 0), MAX_RAIN_STEP_MS);
  const rain = Math.min(Math.max(env.rain, 0), 1);
  RAIN_SHEETS.forEach((spec, index) => {
    const sheet = index as RainSheet;
    const [near, far] = landingBand(sheet, env);
    // Drops on screen = rate x time in the air, so the rate that holds `count`
    // on screen is count over the mean fall time to this sheet's band.
    const fallMs = ((near + far) / 2 + spec.length) / spec.speed;
    field.owed[sheet] += (rain * spec.count * dt) / Math.max(fallMs, 1);
    while (field.owed[sheet] >= 1) {
      field.owed[sheet] -= 1;
      spawn(field, sheet, env);
    }
  });

  for (const drop of field.drops) {
    if (!drop.active) {
      continue;
    }
    const vy = RAIN_SHEETS[drop.sheet].speed;
    const fromX = drop.x;
    const fromY = drop.y;
    drop.y += vy * dt;
    drop.x += vy * env.slant * dt;
    if (drop.y >= drop.landY) {
      // Snap onto the row it was aimed at, along its own line of travel.
      drop.x -= (drop.y - drop.landY) * env.slant;
      drop.y = drop.landY;
      drop.active = false;
      land({ sheet: drop.sheet, fromX, fromY, x: drop.x, y: drop.y });
    }
  }
}

export function clearRainField(field: RainField): void {
  for (const drop of field.drops) {
    drop.active = false;
  }
  field.owed.fill(0);
}

/**
 * Stroke every live drop into `buffer`: a streak `length` pixels long, leaning
 * back up its own velocity, brightening from tail to head.
 *
 * `light` is 0..1 — how lit the world is (daylight, with a floor so night rain
 * still shows) — and walks every streak down the ramp rather than fading it,
 * so dim rain is darker rain, not greyer rain.
 */
export function paintRain(buffer: PixelBuffer, field: RainField, slant: number, light: number): void {
  strokeDrops(field, slant, light, (x, y, ink, alpha) => blendInk(buffer, x, y, ink, alpha));
}

/** The same streaks as a cloud, for the lab — which shows each sheet at full strength. */
export function rainCloud(field: RainField, slant: number, light: number): PixelCloud {
  const cloud: PixelCloud = [];
  strokeDrops(field, slant, light, (x, y, ink) => cloud.push({ x, y, ink }));
  return cloud;
}

function strokeDrops(
  field: RainField,
  slant: number,
  light: number,
  put: (x: number, y: number, ink: InkId, alpha: number) => void,
): void {
  const lit = 0.45 + 0.55 * Math.min(Math.max(light, 0), 1);
  for (const drop of field.drops) {
    if (!drop.active) {
      continue;
    }
    const spec = RAIN_SHEETS[drop.sheet];
    const headX = drop.x;
    const headY = Math.round(drop.y);
    for (let step = spec.length - 1; step >= 0; step -= 1) {
      const y = headY - step;
      const x = Math.round(headX - step * slant);
      const along = spec.length === 1 ? 1 : 1 - step / (spec.length - 1);
      const level = (spec.tail + (spec.head - spec.tail) * along) * lit;
      put(x, y, rampInk(RAIN_RAMP, level, { x, y }), spec.alpha);
    }
  }
}
