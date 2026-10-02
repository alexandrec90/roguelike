/**
 * Cloud shadows: the soft dark patches a fair-weather sky drags across a field.
 *
 * Nothing in the scene would otherwise tell you the sky over the meadow is
 * alive — the clouds in the sky band are a thin strip at the top of the screen.
 * Their shadows are what carry it: slow, soft-edged pools of shade sliding
 * over the grass on the wind, dimming whatever they pass across and then
 * letting it go.
 *
 * One seamless tile of fBm, thresholded and dithered into three levels of
 * shade, baked once. The lighting pass stamps it (MULTIPLY) wherever the wind
 * and the hero's walking have carried it, so it costs a few quads a frame.
 */

import { createBuffer, type PixelBuffer } from "./pixel-buffer";
import { ditherThreshold } from "./shading";
import { pixelHash } from "./transforms";

export const CLOUD_TILE_WIDTH = 320;
export const CLOUD_TILE_HEIGHT = 192;

/** How dark the deepest cloud shade is, as a multiply level. */
const DEEPEST = 0.68;

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise on a lattice that wraps every `cellsX` by `cellsY` cells. */
function periodicNoise(u: number, v: number, cellsX: number, cellsY: number, seed: number): number {
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = fade(u - x0);
  const fy = fade(v - y0);
  const at = (i: number, j: number): number =>
    pixelHash((((x0 + i) % cellsX) + cellsX) % cellsX, (((y0 + j) % cellsY) + cellsY) % cellsY, seed);
  const top = at(0, 0) + (at(1, 0) - at(0, 0)) * fx;
  const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * fx;
  return top + (bottom - top) * fy;
}

/** Seamless fBm over the tile, 0..1. */
export function cloudDensity(x: number, y: number, seed: number): number {
  let sum = 0;
  let total = 0;
  let amplitude = 1;
  for (let octave = 0; octave < 3; octave += 1) {
    const cellsX = 4 << octave;
    const cellsY = 3 << octave;
    sum +=
      amplitude *
      periodicNoise(
        (x / CLOUD_TILE_WIDTH) * cellsX,
        (y / CLOUD_TILE_HEIGHT) * cellsY,
        cellsX,
        cellsY,
        seed + octave * 101,
      );
    total += amplitude;
    amplitude *= 0.5;
  }
  return sum / total;
}

/**
 * The tile, as multiply levels: white where the sun gets through, greys under
 * cloud, the edge dithered so a shadow's rim is soft without being blurred.
 * `cover` is the share of sky that is cloud, 0..1.
 */
export function cloudShadowTile(seed: number, cover = 0.42): PixelBuffer {
  const buffer = createBuffer(CLOUD_TILE_WIDTH, CLOUD_TILE_HEIGHT);
  const threshold = 1 - cover;
  for (let y = 0; y < CLOUD_TILE_HEIGHT; y += 1) {
    for (let x = 0; x < CLOUD_TILE_WIDTH; x += 1) {
      const depth = (cloudDensity(x, y, seed) - threshold) / 0.12;
      const level = depth <= 0 ? 0 : Math.min(depth, 2);
      const base = Math.floor(level);
      const step = level - base > ditherThreshold(x, y) ? base + 1 : base;
      const shade = 1 - (Math.min(step, 2) / 2) * (1 - DEEPEST);
      const value = Math.round(shade * 255);
      const offset = (y * CLOUD_TILE_WIDTH + x) * 4;
      buffer.data[offset] = value;
      buffer.data[offset + 1] = value;
      buffer.data[offset + 2] = Math.min(255, value + 6);
      buffer.data[offset + 3] = 255;
    }
  }
  return buffer;
}

/** Cloud shadows drift downwind this fast, logical pixels per second. */
export const CLOUD_DRIFT_PX = 5;

/**
 * Where the cloud shadows are and how dark: carried by the ground as the hero
 * walks (the odometer) and by the wind on their own, and only on a day with
 * both sun and broken cloud — at night, or under a full overcast, nothing casts.
 */
export function cloudShadowsAt(
  ground: { readonly x: number; readonly y: number },
  elapsedMs: number,
  atmosphere: { readonly overcast: number; readonly daylight: number },
): { x: number; y: number; strength: number } {
  const broken = 1 - Math.abs(atmosphere.overcast - 0.35) * 1.6;
  return {
    x: ground.x + (elapsedMs / 1000) * CLOUD_DRIFT_PX,
    y: ground.y + (elapsedMs / 1000) * CLOUD_DRIFT_PX * 0.3,
    strength: Math.max(0, Math.min(1, 0.55 + broken * 0.45)) * atmosphere.daylight * 0.9,
  };
}

/** The seed of the one cloud-shadow tile the game draws. */
export const CLOUD_SEED = 0xc1d5;

let sharedTile: PixelBuffer | undefined;

/** The game's cloud-shadow tile, baked once and shared by the lighting pass and every sampler. */
export function cloudTile(): PixelBuffer {
  sharedTile ??= cloudShadowTile(CLOUD_SEED);
  return sharedTile;
}

/**
 * The cloud shadow, as something a layer can ask about a screen point.
 *
 * The lighting pass multiplies the drifting tile over the *ground* - everything
 * lying flat - and nothing standing: a screen-space overlay over a tree or a
 * tower that rises past the horizon line would shade it on one side of the line
 * and not the other, because the sky rows above the line must stay unshaded.
 * So a standing thing asks here instead what shadow is on the ground at its foot
 * and takes it as a tint, and a landform asks per pixel. Both read the very
 * pattern the ground shows, so a tree goes dark exactly as the shadow reaches it.
 */
export interface CloudShade {
  /** Changes whenever the pattern on the screen has moved a pixel or changed depth. */
  readonly key: string;
  /** The multiply level at a screen point: 1 in sunlight, less under cloud. */
  at(x: number, y: number): number;
  /** The same, as a tint colour for an image. */
  tint(x: number, y: number): number;
}

/** No cloud: everything in full light. */
export const CLEAR_SKY: CloudShade = { key: "clear", at: () => 1, tint: () => 0xffffff };

/**
 * Sample the cloud shadow the lighting pass stamps for `clouds`, the pass
 * offset by `margin` pixels as its texture is - the same pixel, either way.
 */
export function cloudShade(
  clouds: { readonly x: number; readonly y: number; readonly strength: number },
  margin: number,
  tile: PixelBuffer = cloudTile(),
): CloudShade {
  const strength = Math.min(clouds.strength, 1);
  if (strength <= 0.02) {
    return CLEAR_SKY;
  }
  const offsetX = Math.round(clouds.x);
  const offsetY = Math.round(clouds.y);
  const at = (x: number, y: number): number => {
    const u = ((((Math.round(x) + margin - offsetX) % tile.width) + tile.width) % tile.width) | 0;
    const v = ((((Math.round(y) + margin - offsetY) % tile.height) + tile.height) % tile.height) | 0;
    const value = (tile.data[(v * tile.width + u) * 4] ?? 255) / 255;
    return 1 - (1 - value) * strength;
  };
  return {
    key: `${offsetX},${offsetY},${strength.toFixed(2)}`,
    at,
    tint: (x, y) => {
      const level = Math.round(at(x, y) * 255);
      return (level << 16) | (level << 8) | Math.min(255, level + 4);
    },
  };
}

/** The tile origins that cover a `width` × `height` view scrolled by (x, y). */
export function tileOrigins(
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
): { x: number; y: number }[] {
  const startX = (((Math.round(offsetX) % CLOUD_TILE_WIDTH) + CLOUD_TILE_WIDTH) % CLOUD_TILE_WIDTH) - CLOUD_TILE_WIDTH;
  const startY = (((Math.round(offsetY) % CLOUD_TILE_HEIGHT) + CLOUD_TILE_HEIGHT) % CLOUD_TILE_HEIGHT) - CLOUD_TILE_HEIGHT;
  const origins: { x: number; y: number }[] = [];
  for (let y = startY; y < height; y += CLOUD_TILE_HEIGHT) {
    for (let x = startX; x < width; x += CLOUD_TILE_WIDTH) {
      origins.push({ x, y });
    }
  }
  return origins;
}
