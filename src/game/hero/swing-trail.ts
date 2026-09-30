/**
 * The swing's crescent: where the blade has just been, as a fading ribbon.
 *
 * It is not a drawn arc and it is not history kept by the renderer. The swing
 * is a clip, so where the blade was 18 ms ago is simply the clip sampled 18 ms
 * earlier — the trail is a pure function of the swing's clock and the pose it
 * is layered over, which is what lets the lab show it at any instant and makes
 * a capture repeat. Consecutive blade segments are filled as quads, the newest
 * brightest, and the older ones are dithered away against the Bayer matrix, so
 * the ribbon thins toward its tail the way a smear does without a single
 * half-transparent pixel.
 *
 * Pale steel normally; the fire ramp when the blade burns.
 */

import type { InkId, PixelCloud } from "../ink";
import { BLADE_SPAN, HERO_EQUIPPED, SWING } from "../models";
import { rampSlice } from "../palette";
import { samplePose, solveModel, type RenderOptions, type RigPose } from "../rig";
import { ditherThreshold, rampInk } from "../shading";
import { boneSpan, type ScreenPoint3 } from "./rig-volume";

/** Blade samples kept behind the current one. */
export const TRAIL_SAMPLES = 7;
/** Time between samples, ms of swing clock. */
export const TRAIL_STEP_MS = 16;
/**
 * The trail only exists after the windup peaks: before it the blade is being
 * raised, slowly, and a ribbon there reads as lag rather than speed.
 */
export const TRAIL_FROM_MS = Math.round(SWING.durationMs * 0.3);
/** And it is gone once the swing has settled. */
export const TRAIL_UNTIL_MS = Math.round(SWING.durationMs * 0.78);
/** The ribbon covers the outer part of the blade — the part that moves fastest. */
const RIBBON_FROM = 0.4;

export interface TrailSegment {
  readonly a: ScreenPoint3;
  readonly b: ScreenPoint3;
  /** 0 is now, 1 is the oldest sample. */
  readonly age: number;
}

const STEEL: readonly InkId[] = rampSlice("metal", 2, 4);
const FIRE: readonly InkId[] = rampSlice("fire", 3, 6);

/** The blade's outer span at each of the last few swing times, newest first. */
export function trailSegments(swingMs: number, base: RigPose, options: RenderOptions = {}): TrailSegment[] {
  if (swingMs < TRAIL_FROM_MS || swingMs > TRAIL_UNTIL_MS + TRAIL_SAMPLES * TRAIL_STEP_MS) {
    return [];
  }
  const segments: TrailSegment[] = [];
  const bladeFrom = BLADE_SPAN.from + (BLADE_SPAN.to - BLADE_SPAN.from) * RIBBON_FROM;
  for (let index = 0; index <= TRAIL_SAMPLES; index += 1) {
    const at = swingMs - index * TRAIL_STEP_MS;
    if (at < TRAIL_FROM_MS) {
      break;
    }
    const solved = solveModel(HERO_EQUIPPED, samplePose(SWING, base, Math.min(at, TRAIL_UNTIL_MS)), options);
    const span = boneSpan(solved, "sword", bladeFrom, BLADE_SPAN.to);
    if (span !== undefined) {
      segments.push({ a: span.a, b: span.b, age: index / TRAIL_SAMPLES });
    }
  }
  return segments;
}

function edge(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

function inTriangle(p: readonly [number, number], a: ScreenPoint3, b: ScreenPoint3, c: ScreenPoint3): boolean {
  const d1 = edge(a.x, a.y, b.x, b.y, p[0], p[1]);
  const d2 = edge(b.x, b.y, c.x, c.y, p[0], p[1]);
  const d3 = edge(c.x, c.y, a.x, a.y, p[0], p[1]);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

function fillQuad(
  cloud: PixelCloud,
  seen: Set<number>,
  newer: TrailSegment,
  older: TrailSegment,
  ramp: readonly InkId[],
): void {
  const xs = [newer.a.x, newer.b.x, older.a.x, older.b.x];
  const ys = [newer.a.y, newer.b.y, older.a.y, older.b.y];
  const left = Math.floor(Math.min(...xs));
  const right = Math.ceil(Math.max(...xs));
  const top = Math.floor(Math.min(...ys));
  const bottom = Math.ceil(Math.max(...ys));
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const key = (x + 256) * 1024 + (y + 256);
      if (seen.has(key)) {
        continue;
      }
      const p: readonly [number, number] = [x, y];
      if (!inTriangle(p, newer.a, newer.b, older.b) && !inTriangle(p, newer.a, older.b, older.a)) {
        continue;
      }
      // Older quads thin out by dither; the newest are nearly solid.
      if (older.age * 1.05 > ditherThreshold(x, y) + 0.12) {
        continue;
      }
      seen.add(key);
      cloud.push({ x, y, ink: rampInk(ramp, 1 - newer.age * 1.1, { x, y }) });
    }
  }
}

/**
 * The ribbon as pixels, split by depth: the quads swept behind his body and
 * the ones swept in front, so the layer can draw each on its own side of him.
 */
export function trailCloud(
  segments: readonly TrailSegment[],
  burning: boolean,
): { readonly behind: PixelCloud; readonly front: PixelCloud } {
  const ramp = burning ? FIRE : STEEL;
  const behind: PixelCloud = [];
  const front: PixelCloud = [];
  const seen = new Set<number>();
  for (let index = 0; index + 1 < segments.length; index += 1) {
    const newer = segments[index] as TrailSegment;
    const older = segments[index + 1] as TrailSegment;
    const depth = (newer.a.depth + newer.b.depth + older.a.depth + older.b.depth) / 4;
    fillQuad(depth < 0 ? behind : front, seen, newer, older, ramp);
  }
  return { behind, front };
}
