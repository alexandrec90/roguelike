/**
 * Decals: marks left on the ground, which fade.
 *
 * The eighth primitive in `procedural-effects.md`: "a cloud stamped into the
 * ground layer, fading over time". A scorch after a blast, a puddle of goo
 * where a slime burst, a frost crack where a nova went off — each is a shape
 * built once from a seed at the moment it lands, then only *removed*, pixel by
 * pixel, as it ages. Nothing is re-evaluated per frame but the fade test.
 *
 * The fade is dithered, never alpha: every pixel has its own threshold (the
 * Bayer value jittered by a hash), and once the decal's age passes it the pixel
 * is gone — so a mark erodes from its thin edges inward, the way soot is
 * scuffed away, instead of going uniformly transparent.
 *
 * Decals live on the planet (`at`), so they stay where they were made however
 * far the hero walks; their clouds are offsets from that point in ground pixels,
 * foreshortened like the ground. Capped: the oldest makes way.
 */

import type { InkId, PixelCloud } from "../ink";
import type { PlanetPoint } from "../planet";
import { fbm3, valueNoise2 } from "../procgen/noise";
import { ditherThreshold } from "../shading";
import { pixelHash } from "../transforms";

export type DecalKind = "scorch" | "goo" | "frost";

/** The most marks alive at once. */
export const DECAL_CAP = 24;

/** The ground squash: a round mark lying down is this much shorter than wide. */
const SQUASH = 0.62;

/** How long each kind lasts, and the share of that spent fading out. */
export const DECAL_LIFE: Readonly<Record<DecalKind, number>> = { scorch: 9000, goo: 8000, frost: 3000 };
const FADE_SHARE = 0.45;

/** How long a scorch's embers glow before they are only char. */
export const EMBER_GLOW_MS = 3500;

interface DecalPixel {
  readonly x: number;
  readonly y: number;
  readonly ink: InkId;
  /** 0..1: the age share at which this pixel is gone. Thin edges go first. */
  readonly keep: number;
  /** An ember: glows for the first seconds, then falls back to `ink`. */
  readonly ember?: number;
}

export interface Decal {
  readonly at: PlanetPoint;
  readonly kind: DecalKind;
  readonly seed: number;
  readonly bornMs: number;
  readonly lifeMs: number;
  readonly pixels: readonly DecalPixel[];
}

export interface DecalField {
  readonly decals: Decal[];
  /** Bumped whenever the set changes, so a layer knows to repaint. */
  version: number;
}

export function createDecalField(): DecalField {
  return { decals: [], version: 0 };
}

/** How far a pixel `(x, y)` of a decal holds out against the fade, 0..1. */
function keepAt(x: number, y: number, edge: number, seed: number): number {
  const grain = ditherThreshold(x, y) * 0.6 + pixelHash(x, y, seed, 41) * 0.4;
  // The middle of a mark outlasts its rim.
  return Math.min(1, 0.15 + (1 - edge) * 0.55 + grain * 0.45);
}

/**
 * A blast scar: a charred core, a sheer shadow spreading out in ragged rays,
 * ash flecks, and a few embers still glowing in it.
 */
function scorchPixels(radius: number, seed: number): DecalPixel[] {
  const pixels: DecalPixel[] = [];
  const reachX = Math.ceil(radius * 1.35);
  const reachY = Math.ceil(radius * 1.35 * SQUASH);
  for (let y = -reachY; y <= reachY; y += 1) {
    for (let x = -reachX; x <= reachX; x += 1) {
      const angle = Math.atan2(y / SQUASH, x);
      // The rim is noise round the circle plus a few sharp rays — blast streaks.
      const ragged = 0.72 + 0.4 * fbm3(Math.cos(angle) * 1.6, Math.sin(angle) * 1.6, 0, seed, { octaves: 2 });
      const rays = Math.abs(Math.sin(angle * 4.5 + seed)) ** 12 * 0.45;
      const d = Math.hypot(x, y / SQUASH) / (radius * (ragged + rays));
      if (d > 1) {
        continue;
      }
      const grain = pixelHash(x, y, seed, 40);
      const keep = keepAt(x, y, d, seed);
      if (d > 0.72 && grain < (d - 0.72) * 2.4) {
        continue;
      }
      pixels.push({ x, y, ink: scorchInk(d, grain), keep, ember: emberOf(d, grain, seed, x, y) });
    }
  }
  return pixels;
}

function scorchInk(d: number, grain: number): InkId {
  if (d < 0.4) {
    return grain > 0.86 ? "smoke-3" : grain > 0.45 ? "bark-0" : "earth-0";
  }
  if (d < 0.7) {
    return grain > 0.9 ? "bark-0" : "shadow";
  }
  return "shadow-soft";
}

function emberOf(d: number, grain: number, seed: number, x: number, y: number): number | undefined {
  if (d > 0.55 || grain < 0.45 || grain > 0.86 || pixelHash(x, y, seed, 42) > 0.3) {
    return undefined;
  }
  return pixelHash(x, y, seed, 43);
}

/** Burst jelly: a sheer puddle with a lit rim, a glint, and splashes around it. */
function gooPixels(radius: number, seed: number): DecalPixel[] {
  const pixels: DecalPixel[] = [];
  const reachX = Math.ceil(radius * 1.6);
  const reachY = Math.ceil(radius * 1.6 * SQUASH);
  for (let y = -reachY; y <= reachY; y += 1) {
    for (let x = -reachX; x <= reachX; x += 1) {
      const lump = 0.75 + 0.45 * valueNoise2(x / 3 + seed, y / (3 * SQUASH), seed);
      const d = Math.hypot(x, y / SQUASH) / (radius * lump);
      const keep = keepAt(x, y, Math.min(d, 1), seed);
      if (d <= 1) {
        const rim = d > 0.78 || (y < 0 && d > 0.6 && pixelHash(x, y, seed, 44) > 0.6);
        const glint = x < 0 && y < 0 && d < 0.4 && pixelHash(x, y, seed, 45) > 0.8;
        pixels.push({ x, y, ink: glint ? "slime-4" : rim ? "slime-3" : "slime-1", keep });
      } else if (d < 1.55 && pixelHash(x, y, seed, 46) > 0.965) {
        pixels.push({ x, y, ink: "slime-2", keep: keep * 0.7 });
      }
    }
  }
  return pixels;
}

/**
 * Frost: a Voronoi crack pattern — seeded points, and a line wherever two of
 * them are nearly equally near — over a thin rime.
 */
function frostPixels(radius: number, seed: number): DecalPixel[] {
  // One site at the heart and a stratified ring round it, so the cells are
  // even all the way round rather than wherever the hash happened to cluster.
  const ring = 8;
  const sites = [
    { x: 0, y: 0 },
    ...Array.from({ length: ring }, (_unused, index) => {
      const angle = ((index + pixelHash(index, 0, seed, 50) * 0.7) / ring) * Math.PI * 2;
      const reach = radius * (0.55 + pixelHash(index, 0, seed, 51) * 0.4);
      return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach };
    }),
  ];
  const pixels: DecalPixel[] = [];
  const reachX = Math.ceil(radius * 1.2);
  const reachY = Math.ceil(radius * 1.2 * SQUASH);
  for (let y = -reachY; y <= reachY; y += 1) {
    for (let x = -reachX; x <= reachX; x += 1) {
      const d = Math.hypot(x, y / SQUASH) / (radius * (0.85 + 0.3 * valueNoise2(x / 4, y / 3, seed)));
      if (d > 1) {
        continue;
      }
      const gap = voronoiGap(sites, x, y / SQUASH);
      const keep = keepAt(x, y, d, seed);
      if (gap < 0.75 && pixelHash(x, y, seed, 53) > d * 0.35) {
        pixels.push({ x, y, ink: d < 0.45 ? "frost-4" : "frost-3", keep });
      } else if ((1 - d) * 0.45 > ditherThreshold(x, y) + pixelHash(x, y, seed, 52) * 0.3) {
        pixels.push({ x, y, ink: d < 0.4 ? "frost-2" : "frost-1", keep });
      }
    }
  }
  return pixels;
}

/** Difference between the nearest and second-nearest site: ~0 on a cell edge. */
function voronoiGap(sites: readonly { x: number; y: number }[], x: number, y: number): number {
  let first = Number.POSITIVE_INFINITY;
  let second = Number.POSITIVE_INFINITY;
  for (const site of sites) {
    const d = Math.hypot(x - site.x, y - site.y);
    if (d < first) {
      second = first;
      first = d;
    } else if (d < second) {
      second = d;
    }
  }
  return second - first;
}

const SHAPES: Readonly<Record<DecalKind, (radius: number, seed: number) => DecalPixel[]>> = {
  scorch: scorchPixels,
  goo: gooPixels,
  frost: frostPixels,
};

/** Default size per kind, pixels across the long axis's half. */
export const DECAL_RADIUS: Readonly<Record<DecalKind, number>> = { scorch: 12, goo: 7, frost: 16 };

export function createDecal(at: PlanetPoint, kind: DecalKind, seed: number, bornMs: number, radius?: number): Decal {
  return {
    at,
    kind,
    seed,
    bornMs,
    lifeMs: DECAL_LIFE[kind],
    pixels: SHAPES[kind](radius ?? DECAL_RADIUS[kind], seed),
  };
}

/** Lay a mark down. Past the cap the oldest is dropped. */
export function stampDecal(field: DecalField, decal: Decal): void {
  field.decals.push(decal);
  while (field.decals.length > DECAL_CAP) {
    field.decals.shift();
  }
  field.version += 1;
}

/** Drop every mark that has faded completely. */
export function pruneDecals(field: DecalField, nowMs: number): void {
  const before = field.decals.length;
  for (let index = field.decals.length - 1; index >= 0; index -= 1) {
    const decal = field.decals[index];
    if (decal !== undefined && nowMs - decal.bornMs >= decal.lifeMs) {
      field.decals.splice(index, 1);
    }
  }
  if (field.decals.length !== before) {
    field.version += 1;
  }
}

/**
 * The mark as it is at `nowMs`, in pixels from its planet point.
 *
 * Whole for the first part of its life; after that each pixel leaves when the
 * fade passes its own `keep`. A scorch's embers glow down the fire ramp for
 * their first seconds, each breathing on its own phase.
 */
export function decalCloud(decal: Decal, nowMs: number): PixelCloud {
  const age = Math.max(0, nowMs - decal.bornMs);
  const fadeFrom = decal.lifeMs * (1 - FADE_SHARE);
  const fade = age <= fadeFrom ? 0 : (age - fadeFrom) / (decal.lifeMs - fadeFrom);
  const glow = Math.max(0, 1 - age / EMBER_GLOW_MS);
  const cloud: PixelCloud = [];
  for (const pixel of decal.pixels) {
    if (fade >= pixel.keep) {
      continue;
    }
    cloud.push({ x: pixel.x, y: pixel.y, ink: pixel.ember === undefined ? pixel.ink : emberInk(pixel, glow, age) });
  }
  return cloud;
}

function emberInk(pixel: DecalPixel, glow: number, age: number): InkId {
  const phase = (pixel.ember ?? 0) * Math.PI * 2;
  const heat = glow * (0.55 + 0.45 * Math.sin(age / 260 + phase));
  if (heat > 0.75) {
    return "fire-5";
  }
  if (heat > 0.5) {
    return "fire-4";
  }
  if (heat > 0.28) {
    return "fire-3";
  }
  return heat > 0.1 ? "fire-2" : pixel.ink;
}
