/**
 * The tree gallery's pure half: its state, its grid, and its grounds.
 *
 * Everything here is a function of arguments — no DOM, no canvas, no clock — so
 * the layout and the URL round-trip are testable, and `main.ts` is left with
 * nothing but wiring. That is the same split the asset lab uses, for the same
 * reason: the parts worth being sure about should not need a browser.
 *
 * The gallery exists because eight procedural mechanisms cannot be judged one
 * at a time. Wind, light and weather are global, and the question being asked
 * is which mechanism reads best *next to the others* under the same gust.
 */

import { createRaster, fillRect, paintCloud, type RasterBuffer } from "../game/cloud-raster";
import { INK_COLORS, type PixelCloud } from "../game/ink";
import { fbm2 } from "../game/procgen/noise";
import { ditherThreshold } from "../game/shading";
import { pixelHash } from "../game/transforms";

export const GROUNDS = ["duo", "black", "grass", "water"] as const;
export type Ground = (typeof GROUNDS)[number];

export const ZOOMS = [1, 2, 3, 4, 6] as const;

export interface GalleryState {
  /** Wind strength multiplier, 0..2.5. */
  readonly wind: number;
  /** 0 steady, 1 squally. */
  readonly gust: number;
  /** Light direction in degrees; 0 is from the right, 90 from below. */
  readonly lightAngle: number;
  /** Sun height, 0.15..1. Low is a long raking shadow. */
  readonly elevation: number;
  readonly rain: number;
  readonly snow: number;
  /**
   * How many field rows away the bodies are standing.
   *
   * Distance does not change an object'''s size here — the ground is affine — so
   * this changes only the *detail budget* it is drawn with (see lod.ts). It is
   * on the toolbar because the thing worth checking is that a body gains detail
   * continuously as it rolls closer rather than popping between versions.
   */
  readonly distance: number;
  readonly shadow: boolean;
  readonly reflection: boolean;
  readonly ground: Ground;
  readonly zoom: number;
  readonly play: boolean;
  /** Time scale, so a gust can be watched in slow motion. */
  readonly speed: number;
  readonly seed: number;
  /** A species id to show alone, or "" for the whole grid. */
  readonly solo: string;
}

export const DEFAULT_GALLERY: GalleryState = {
  wind: 1,
  gust: 0.6,
  lightAngle: 205,
  elevation: 0.7,
  rain: 0,
  snow: 0,
  distance: 0,
  shadow: true,
  reflection: false,
  ground: "duo",
  zoom: 3,
  play: true,
  speed: 1,
  seed: 0x7e31,
  solo: "",
};

function readNumber(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  const value = raw === null ? Number.NaN : Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readFlag(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = params.get(key);
  return raw === null ? fallback : raw === "1" || raw === "true";
}

export function parseGalleryState(search: string): GalleryState {
  const params = new URLSearchParams(search);
  const ground = params.get("ground");
  return {
    wind: clamp(readNumber(params, "wind", DEFAULT_GALLERY.wind), 0, 2.5),
    gust: clamp(readNumber(params, "gust", DEFAULT_GALLERY.gust), 0, 1),
    lightAngle: readNumber(params, "light", DEFAULT_GALLERY.lightAngle),
    elevation: clamp(readNumber(params, "sun", DEFAULT_GALLERY.elevation), 0.15, 1),
    rain: clamp(readNumber(params, "rain", DEFAULT_GALLERY.rain), 0, 1),
    snow: clamp(readNumber(params, "snow", DEFAULT_GALLERY.snow), 0, 1),
    distance: clamp(Math.round(readNumber(params, "far", DEFAULT_GALLERY.distance)), 0, 30),
    shadow: readFlag(params, "shadow", DEFAULT_GALLERY.shadow),
    reflection: readFlag(params, "reflect", DEFAULT_GALLERY.reflection),
    ground: (GROUNDS as readonly string[]).includes(ground ?? "")
      ? (ground as Ground)
      : DEFAULT_GALLERY.ground,
    zoom: nearestZoom(readNumber(params, "zoom", DEFAULT_GALLERY.zoom)),
    play: readFlag(params, "play", DEFAULT_GALLERY.play),
    speed: clamp(readNumber(params, "speed", DEFAULT_GALLERY.speed), 0.1, 3),
    seed: Math.trunc(readNumber(params, "seed", DEFAULT_GALLERY.seed)),
    solo: params.get("solo") ?? DEFAULT_GALLERY.solo,
  };
}

export function serializeGalleryState(state: GalleryState): string {
  const params = new URLSearchParams({
    wind: state.wind.toFixed(2),
    gust: state.gust.toFixed(2),
    light: String(Math.round(state.lightAngle)),
    sun: state.elevation.toFixed(2),
    rain: state.rain.toFixed(2),
    snow: state.snow.toFixed(2),
    far: String(state.distance),
    shadow: state.shadow ? "1" : "0",
    reflect: state.reflection ? "1" : "0",
    ground: state.ground,
    zoom: String(state.zoom),
    play: state.play ? "1" : "0",
    speed: state.speed.toFixed(2),
    seed: String(state.seed),
  });
  if (state.solo !== "") {
    params.set("solo", state.solo);
  }
  return `?${params.toString()}`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function nearestZoom(value: number): number {
  return ZOOMS.reduce((best, zoom) => (Math.abs(zoom - value) < Math.abs(best - value) ? zoom : best), ZOOMS[0]);
}

/** Screen-space light from an angle in degrees; +y is down, as clouds are. */
export function lightVector(degrees: number): { readonly x: number; readonly y: number } {
  const radians = (degrees * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

export interface GalleryCell {
  readonly index: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Where the tree's foot sits inside the buffer. */
  readonly footX: number;
  readonly footY: number;
}

export interface GalleryGrid {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly GalleryCell[];
}

/** A grid wide enough for `count` cells, at most `columns` across. */
export function galleryLayout(
  count: number,
  cellWidth: number,
  cellHeight: number,
  columns: number,
): GalleryGrid {
  if (count < 1) {
    throw new Error("A gallery needs at least one cell");
  }
  const across = Math.max(1, Math.min(columns, count));
  const rows = Math.ceil(count / across);
  const cells: GalleryCell[] = [];
  for (let index = 0; index < count; index += 1) {
    const left = (index % across) * cellWidth;
    const top = Math.floor(index / across) * cellHeight;
    cells.push({
      index,
      left,
      top,
      width: cellWidth,
      height: cellHeight,
      footX: left + Math.floor(cellWidth / 2),
      // Room below the foot for the shadow to rake and the reflection to fall.
      footY: top + cellHeight - 14,
    });
  }
  return { width: across * cellWidth, height: rows * cellHeight, cells };
}

export function createGalleryBuffer(grid: GalleryGrid): RasterBuffer {
  return createRaster(grid.width, grid.height);
}

/**
 * Lay the ground for one cell.
 *
 * `duo` splits the cell so the same tree straddles black and bone at once,
 * which is the only way to catch a silhouette that works on one and vanishes on
 * the other. `grass` is the one that shows a cast shadow, because a shadow here
 * is `void` punching through lit ground and there is nothing to punch through
 * on black. `water` is for judging a reflection.
 */
export function paintGround(buffer: RasterBuffer, cell: GalleryCell, ground: Ground, seed: number): void {
  fillRect(buffer, { x: cell.left, y: cell.top, width: cell.width, height: cell.height }, "#000000");
  if (ground === "black") {
    return;
  }
  if (ground === "duo") {
    const half = Math.floor(cell.width / 2);
    fillRect(buffer, { x: cell.left + half, y: cell.top, width: cell.width - half, height: cell.height }, "#c8d2de");
    return;
  }
  const bandTop = cell.footY - 2;
  const band = cell.top + cell.height - bandTop;
  if (ground === "water") {
    fillRect(buffer, { x: cell.left, y: bandTop, width: cell.width, height: band }, INK_COLORS.water);
    return;
  }
  paintGrass(buffer, cell, bandTop, seed);
}

/** A lit grass bed: seeded stipple, not a flat fill, so a shadow has texture to eat. */
function paintGrass(buffer: RasterBuffer, cell: GalleryCell, bandTop: number, seed: number): void {
  const cloud: PixelCloud = [];
  for (let y = bandTop; y < cell.top + cell.height; y += 1) {
    for (let x = cell.left; x < cell.left + cell.width; x += 1) {
      const blade = fbm2(x / 5, y / 3, seed, { octaves: 2 });
      const lit = blade > 0.56 && pixelHash(x, y, seed, 3) > ditherThreshold(x, y) * 0.7;
      cloud.push({ x: x - cell.left, y: y - cell.top, ink: lit ? "neon-green" : "deep" });
    }
  }
  paintCloud(buffer, cloud, cell.left, cell.top);
}
