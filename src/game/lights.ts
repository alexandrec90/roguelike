/**
 * Point lights: what a flame, a spell or a lightning strike contributes to the
 * picture beyond its own pixels.
 *
 * A producer — the campfire, a fireball, the burning blade — pushes a
 * `LightSource` into the frame's list; `lighting-layer.ts` turns the list into
 * light on the world. Producers only ever *describe* light; nothing but the
 * lighting layer draws it, so a torch and a fireball can never disagree about
 * how light falls off.
 *
 * The falloff is a baked, dithered disc (`lightFalloff`), not a smooth radial
 * gradient: quantised into a few bands with the same 4x4 Bayer matrix every
 * other gradient in the game uses, so a pool of firelight is pixel art too.
 */

import { hexToRgb } from "./color";
import { createBuffer, type PixelBuffer } from "./pixel-buffer";
import { fbm3 } from "./procgen/noise";
import { ditherThreshold } from "./shading";

export interface LightSource {
  /** Screen position, logical pixels. */
  readonly x: number;
  readonly y: number;
  /** Reach, logical pixels. The pool is foreshortened like the ground it lights. */
  readonly radius: number;
  /** `#rrggbb`. */
  readonly color: string;
  /** 0..1.5 — how much it lifts the dark. Over 1 saturates at the centre. */
  readonly intensity: number;
}

/** How many brightness bands a light pool is quantised into. */
export const LIGHT_BANDS = 6;

/** The ground is foreshortened, so a pool of light is an ellipse this squat. */
export const LIGHT_SQUASH = 0.75;

/**
 * A flame's brightness wobble, 0.75..1.1: two octaves of seeded noise over time,
 * so two fires side by side flicker independently and a capture at a fixed
 * time reproduces.
 */
export function flicker(elapsedMs: number, seed: number): number {
  const slow = fbm3(elapsedMs / 380, 0, 0, seed, { octaves: 2 });
  const fast = fbm3(0, elapsedMs / 70, 0, seed + 17, { octaves: 1 });
  return 0.75 + slow * 0.25 + fast * 0.1;
}

/**
 * Light level at a pixel offset from the centre of a unit pool, 0..1, banded
 * and dithered.
 *
 * `dx`/`dy` are in pixels, `radius` is the pool's reach. The curve is a soft
 * quadratic with a bright core, then cut into `LIGHT_BANDS` levels with the
 * Bayer threshold deciding each pixel between two bands.
 */
export function lightFalloff(dx: number, dy: number, radius: number): number {
  const distance = Math.hypot(dx, dy / LIGHT_SQUASH) / Math.max(radius, 1);
  if (distance >= 1) {
    return 0;
  }
  const curve = (1 - distance) ** 1.6;
  const scaled = curve * LIGHT_BANDS;
  const base = Math.floor(scaled);
  const level = scaled - base > ditherThreshold(dx, dy) ? base + 1 : base;
  return Math.min(level, LIGHT_BANDS) / LIGHT_BANDS;
}

/** A white pool of light of `radius`, banded and dithered, foreshortened. */
export function lightPool(radius: number): PixelBuffer {
  const width = radius * 2 + 1;
  const height = Math.ceil(radius * LIGHT_SQUASH) * 2 + 1;
  const buffer = createBuffer(width, height);
  const centreY = (height - 1) / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const level = lightFalloff(x - radius, y - centreY, radius);
      const offset = (y * width + x) * 4;
      const value = Math.round(level * 255);
      buffer.data[offset] = value;
      buffer.data[offset + 1] = value;
      buffer.data[offset + 2] = value;
      buffer.data[offset + 3] = 255;
    }
  }
  return buffer;
}

/** The brightness of an ambient colour, 0..1 — how dark the world is. */
export function ambientLevel(ambient: string): number {
  const { r, g, b } = hexToRgb(ambient);
  return (0.3 * r + 0.55 * g + 0.15 * b) / 255;
}
