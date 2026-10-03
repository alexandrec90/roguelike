/**
 * How a landform looks: flat illustration, on purpose. A material per surface -
 * grass, rock, snow, cliff strata, tower stone, roof - lit by the screen-space
 * sun in a handful of ramp steps, with a narrow dithered seam where one step
 * meets the next, and a planet-fixed grain on standing faces (courses on a
 * tower, ledges on rock, strata on a cliff) that turns with the landform as the
 * hero circles it. Every colour here is a named ink; the air and the clouds are
 * laid over it by the march.
 */

import { hexToRgb, type Rgb } from "./color";
import { INK_COLORS, type InkId } from "./ink";
import { bayer, type LandformLight } from "./landform-frame";
import { CLIFF, GRASS, isRoofed, ROCK, ROOF, SNOW, WALL, type LandformField } from "./landforms";
import { rampSlice } from "./palette";
import { TILE_WIDTH } from "./projection";

/** The ramp each material is lit along, darkest first. */
export const RAMPS: Readonly<Record<number, readonly Rgb[]>> = {
  [GRASS]: rgbs(rampSlice("grass", 1, 5)),
  [ROCK]: rgbs(rampSlice("stone", 2, 6)),
  [SNOW]: rgbs([...rampSlice("frost", 2, 5), "foam"]),
  [CLIFF]: rgbs(rampSlice("earth", 1, 6)),
  [WALL]: rgbs(rampSlice("stone", 2, 6)),
  [ROOF]: rgbs(rampSlice("crimson", 0, 4)),
};

/** The second strata of a cliff, banded between the first: a darker, redder rock. */
export const STRATA = rgbs(rampSlice("autumn", 0, 4));
export const WINDOW = hexToRgb(INK_COLORS["stone-0"]);

function rgbs(inks: readonly InkId[]): Rgb[] {
  return inks.map((ink) => hexToRgb(INK_COLORS[ink]));
}

/**
 * How lit a surface is under the light, 0..1. Wrapped ("half-Lambert"): a face
 * turned from the light still falls off gradually instead of all going to the
 * floor, which is what keeps a steep slope a readable plane, not a black wall.
 */
export function surfaceLevel(
  normal: { readonly x: number; readonly y: number; readonly z: number },
  light: LandformLight,
): number {
  const lift = Math.min(Math.max(light.elevation, 0.1), 1);
  const across = Math.sqrt(1 - lift * lift);
  const facing = normal.x * light.light.x * across - normal.y * light.light.y * across + normal.z * lift;
  return wrapLevel(facing);
}

/** The wrapped light curve, tabled: it is asked once per span of every landform pixel. */
const WRAP = Float32Array.from({ length: 257 }, (_unused, index) => 0.12 + 0.88 * (index / 256) ** 1.4);

/** How lit a surface is that faces the light by `facing`, -1..1. */
export function wrapLevel(facing: number): number {
  const index = Math.round((Math.min(Math.max(facing, -1), 1) * 0.5 + 0.5) * 256);
  return WRAP[index] ?? 0;
}

/** Share of a ramp step either side of its middle over which two steps are dithered together. */
export const SEAM = 0.12;

/**
 * A ramp step for a level: flat bands, as an illustration is shaded, with only a
 * narrow dithered seam where one step gives way to the next - not a gradient
 * dithered across the whole step, which reads as a checkerboard on rock.
 */
export function stepOf(ramp: readonly Rgb[], level: number, x: number, y: number): Rgb {
  const scaled = Math.min(Math.max(level, 0), 1) * (ramp.length - 1);
  const base = Math.floor(scaled);
  const fraction = scaled - base;
  const blend = (fraction - (0.5 - SEAM)) / (2 * SEAM);
  const index = blend >= 1 || (blend > 0 && blend > bayer(x, y)) ? base + 1 : base;
  return ramp[Math.min(index, ramp.length - 1)] ?? ramp[0] ?? { r: 0, g: 0, b: 0 };
}

/** What one surface point looks like, before the air and the clouds. */
export interface Surface {
  readonly material: number;
  /** Height of the point, pixels at full size. */
  readonly z: number;
  /** Planet offset from the landform's centre, tiles - for a tower's windows. */
  readonly px: number;
  readonly py: number;
  readonly level: number;
  /** Whether it is on a standing face rather than a top. */
  readonly wall: boolean;
  /** How far round the landform the point is, 0..1 of a turn: the same for a whole span. */
  readonly around: number;
  /** How far the strata wander at the point, in pixels of height: the same for a whole span. */
  readonly wander: number;
}

/** Mutable while a span is painted, so a pixel allocates nothing. */
export interface SurfaceDraft {
  material: number;
  z: number;
  px: number;
  py: number;
  level: number;
  wall: boolean;
  around: number;
  wander: number;
}

/**
 * Fill in what a span shares - where round the landform it is, how its strata
 * wander - once, rather than an arctangent and two sines per pixel of it.
 */
export function spanOf(field: LandformField, surface: SurfaceDraft): void {
  surface.around = (Math.atan2(surface.py, surface.px) / (Math.PI * 2) + 1) % 1;
  surface.wander =
    Math.sin(surface.px * 1.7 + field.landform.seed) * 2.2 + Math.cos(surface.py * 1.3) * 1.6;
}

export function colourOf(field: LandformField, surface: Surface, x: number, y: number): Rgb {
  const { kind, height } = field.landform;
  if (surface.wall && kind === "tower" && isWindow(field, surface)) {
    return WINDOW;
  }
  const level = surface.wall ? surface.level + faceGrain(field, surface) : surface.level;
  if (surface.material === CLIFF && isStratum(field, surface)) {
    return stepOf(STRATA, level * 0.85, x, y);
  }
  if (surface.wall && kind === "mountain" && surface.z < height * 0.7) {
    return stepOf(RAMPS[ROCK] ?? [], level, x, y);
  }
  return stepOf(RAMPS[surface.material] ?? [], level, x, y);
}

/** A small integer hash to 0..1, for the face grain's blocks. */
function blockHash(a: number, b: number, seed: number): number {
  let h = Math.imul(a ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul(b ^ seed, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 0x100000000;
}

/**
 * The texture of a standing face, as a nudge to its light: a tower is laid in
 * courses with staggered joints; rock is blocky with ledges that wander along
 * it. Measured round the landform in planet-fixed pixels and up it in height,
 * so the pattern turns with the landform as the hero circles it.
 */
function faceGrain(field: LandformField, surface: Surface): number {
  const { seed, radius, kind } = field.landform;
  const around = surface.around * Math.PI * 2 * radius * TILE_WIDTH;
  if (kind === "tower") {
    const course = Math.floor(surface.z / 6);
    if (surface.z - course * 6 < 1) {
      return -0.16;
    }
    const along = around + (course % 2) * 7;
    return along % 14 < 1 ? -0.12 : (blockHash(Math.floor(along / 14), course, seed) - 0.5) * 0.08;
  }
  const ledge = (surface.z + 4 * Math.sin(around / 9 + seed)) % 13;
  if (ledge < 1.2) {
    return -0.18;
  }
  return (blockHash(Math.floor(around / 9), Math.floor(surface.z / 7), seed) - 0.5) * 0.22;
}

/**
 * Whether a cliff point is on one of the redder strata: thin bands at uneven
 * heights, their edges wandering with the planet-fixed position, so a mesa is
 * bedded rock rather than a striped cake.
 */
function isStratum(field: LandformField, surface: Surface): boolean {
  const band = (surface.z + surface.wander) / 11 + (field.landform.seed % 7);
  const phase = band - Math.floor(band);
  return Math.floor(band) % 3 === 0 && phase < 0.45;
}

/** A tower's windows: a few dark slots between floors, every third bay, turning with the tower. */
function isWindow(field: LandformField, surface: Surface): boolean {
  const { height, radius } = field.landform;
  if (surface.z < 22 || surface.z > height - 16) {
    return false;
  }
  const bays = 4 * Math.round(2 * radius) * 1.5;
  const around = surface.around * bays;
  const bay = Math.floor(around);
  const across = around - bay;
  const floor = (surface.z - 22) / 30;
  const up = floor - Math.floor(floor);
  return bay % 3 === 1 && across > 0.25 && across < 0.75 && up > 0.35 && up < 0.8;
}

/** What a standing face is made of, by kind and height. */
export function wallMaterial(field: LandformField, z: number): number {
  switch (field.landform.kind) {
    case "mountain":
      return z > field.landform.height * 0.75 ? SNOW : ROCK;
    case "mesa":
      return CLIFF;
    case "spire":
      return ROCK;
    case "tower":
      return z > field.landform.height + 0.5 && isRoofed(field.landform) ? ROOF : WALL;
  }
}
