/**
 * The small life of the meadow: fireflies at dusk, pollen and seed-fluff by day.
 *
 * Neither is a place on the planet — nobody walks back to *that* firefly — so
 * both live in the ground's own frame, carried by the odometer as the hero
 * walks (`odometer.ts`) and wrapped round a field a little larger than the
 * screen. What makes them read as alive rather than as noise is that each one
 * *wanders* on a curl field (so they drift in loops, never in straight lines)
 * and each firefly *blinks* on its own slow cycle, a seeded phase apart.
 *
 * Pure and deterministic: a mote's position and glow are functions of its seed
 * and the clock, with no integrated state, so a capture at a time reproduces
 * and a thousand frames of play cost no drift.
 */

import type { InkId, PixelCloud } from "./ink";
import type { LightSource } from "./lights";
import { curlFlow } from "./procgen/noise";
import { pixelHash } from "./transforms";

/** The wrap field, a little wider and taller than the target. */
const FIELD_WIDTH = 384;
const FIELD_HEIGHT = 224;

export const FIREFLY_COUNT = 18;
export const POLLEN_COUNT = 26;

export interface Mote {
  readonly x: number;
  readonly y: number;
  readonly ink: InkId;
  /** 0..1 — a firefly's glow; pollen is always 1. */
  readonly glow: number;
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/**
 * A mote's wandering position: a home that the ground carries, plus a slow
 * loop through a curl field, plus a steady drift for pollen on the wind.
 */
function wander(
  index: number,
  seed: number,
  elapsedMs: number,
  ground: { readonly x: number; readonly y: number },
  drift: number,
): { x: number; y: number } {
  const homeX = pixelHash(index, 0, seed, 1) * FIELD_WIDTH;
  const homeY = pixelHash(index, 0, seed, 2) * FIELD_HEIGHT;
  const t = elapsedMs / 1000;
  const flow = curlFlow(homeX / 60, homeY / 60, t * 0.12 + index, seed, 0.6);
  const loopX = Math.sin(t * 0.7 + index * 1.3) * 9 + flow.x * 14;
  const loopY = Math.cos(t * 0.53 + index * 0.7) * 5 + flow.y * 10;
  return {
    x: wrap(homeX + ground.x + loopX + drift * t, FIELD_WIDTH) - (FIELD_WIDTH - 320) / 2,
    y: wrap(homeY + ground.y + loopY, FIELD_HEIGHT) - (FIELD_HEIGHT - 180) / 2,
  };
}

/**
 * Fireflies: out from dusk, gone by dawn. `night` is 0..1 (1 - daylight).
 * Each pulses on a seeded 2–3.5 s cycle, mostly dark with a bright swell.
 */
export function fireflies(
  elapsedMs: number,
  night: number,
  ground: { readonly x: number; readonly y: number },
  seed = 0xf1f1,
): Mote[] {
  if (night < 0.25) {
    return [];
  }
  const out: Mote[] = [];
  const count = Math.round(FIREFLY_COUNT * Math.min(1, (night - 0.25) / 0.5));
  for (let index = 0; index < count; index += 1) {
    const period = 2000 + pixelHash(index, 1, seed, 3) * 1500;
    const phase = ((elapsedMs + pixelHash(index, 1, seed, 4) * period) % period) / period;
    const glow = Math.max(0, Math.sin(phase * Math.PI * 2)) ** 3;
    const at = wander(index, seed, elapsedMs, ground, 0);
    out.push({ x: Math.round(at.x), y: Math.round(at.y), ink: glow > 0.5 ? "meadow-4" : "meadow-2", glow });
  }
  return out;
}

/** Pollen and thistledown: pale specks sailing downwind on a fair day. */
export function pollen(
  elapsedMs: number,
  daylight: number,
  wind: number,
  ground: { readonly x: number; readonly y: number },
  seed = 0x9011,
): Mote[] {
  if (daylight < 0.4) {
    return [];
  }
  const out: Mote[] = [];
  for (let index = 0; index < POLLEN_COUNT; index += 1) {
    const at = wander(index, seed, elapsedMs, ground, 6 + wind * 10);
    const ink: InkId = pixelHash(index, 5, seed, 6) < 0.3 ? "petal-1" : "petal-2";
    out.push({ x: Math.round(at.x), y: Math.round(at.y), ink, glow: 1 });
  }
  return out;
}

/** Motes as pixels; a firefly only shows while it is lit. */
export function moteCloud(motes: readonly Mote[]): PixelCloud {
  const cloud: PixelCloud = [];
  for (const mote of motes) {
    if (mote.glow > 0.12) {
      cloud.push({ x: mote.x, y: mote.y, ink: mote.ink });
    }
  }
  return cloud;
}

/** Each lit firefly is a tiny light: a pale green prick in the dark. */
export function moteLights(motes: readonly Mote[]): LightSource[] {
  return motes
    .filter((mote) => mote.glow > 0.35)
    .map((mote) => ({ x: mote.x, y: mote.y, radius: 9, color: "#d8f07a", intensity: 0.55 * mote.glow }));
}
