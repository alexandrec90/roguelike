/**
 * Time of day and weather, as one pure function the whole picture reads.
 *
 * Everything that depends on the sky — the light direction every volume is shaded
 * from, how long and how dark a cast shadow is, the colour the world is
 * multiplied by, the sky's gradient, whether the stars are out — comes from
 * `atmosphereAt(hours, overcast)`. Nothing else decides any of it, so dusk
 * arrives everywhere on the same frame: the shadows lengthen as the ground
 * warms to orange as the stars come out, because all three read one number.
 *
 * **The sun is in screen space.** The camera turns with the hero, and a light
 * anchored to the planet would force every model to be re-lit per heading
 * (`CLAUDE.md`, "the one thing that would break it"). So the sun here is a
 * direction *on the screen*: it rises on the left, crosses the top and sets on
 * the right, whichever way the hero happens to be walking. The player cannot
 * perceive absolute rotation, so nothing is lost and every bake survives a turn.
 */

import { hexToRgb, mixHex, rgbToHex } from "./color";

/** A day, in milliseconds of play, when nobody pins the clock. */
export const DEFAULT_DAY_MS = 20 * 60 * 1000;

/** Where the clock starts on an ordinary load: late afternoon, dusk ahead. */
export const DEFAULT_START_HOURS = 15.5;

export interface Atmosphere {
  /** 0..24. */
  readonly hours: number;
  /** 0 at night, 1 in full day; the sun's (or moon's) share of the light. */
  readonly daylight: number;
  /** Screen-space direction toward the light; +y is down. Unit length. */
  readonly light: { readonly x: number; readonly y: number };
  /** 0.15 at a raking dawn, 1 at noon. What a cast shadow's length reads. */
  readonly elevation: number;
  /** How dark cast shadows are, 0..1 — they fade out as the light goes flat. */
  readonly shadowStrength: number;
  /** The colour the lit world is multiplied by. `#ffffff` is unlit noon. */
  readonly ambient: string;
  /** Sky gradient, zenith to horizon. */
  readonly skyTop: string;
  readonly skyHorizon: string;
  /** The ground on the horizon roll: haze at the far edge of the world. */
  readonly haze: string;
  readonly starAlpha: number;
  /** 0 clear .. 1 fully overcast; dims and greys everything. */
  readonly overcast: number;
}

interface Key {
  readonly hours: number;
  readonly ambient: string;
  readonly skyTop: string;
  readonly skyHorizon: string;
  readonly haze: string;
}

/**
 * The day, as keys the clock blends between. Night is moonlit rather than
 * black: a scene the player cannot see is not atmosphere, it is a bug report.
 */
const KEYS: readonly Key[] = [
  { hours: 0, ambient: "#4c5a92", skyTop: "#050817", skyHorizon: "#18244a", haze: "#1c2848" },
  { hours: 4.5, ambient: "#4c5a92", skyTop: "#070b1e", skyHorizon: "#1e2a52", haze: "#1f2b4c" },
  { hours: 5.75, ambient: "#9a7f9c", skyTop: "#27305e", skyHorizon: "#d9887a", haze: "#6b5b78" },
  { hours: 7, ambient: "#f0ddc8", skyTop: "#4b77b8", skyHorizon: "#f3c79a", haze: "#9fb0c0" },
  { hours: 9, ambient: "#fbf4ea", skyTop: "#3d7cc9", skyHorizon: "#b6d6ee", haze: "#a8c2d4" },
  { hours: 13, ambient: "#ffffff", skyTop: "#3a7fd0", skyHorizon: "#bfe0f4", haze: "#b3cddd" },
  { hours: 16.5, ambient: "#fff1dc", skyTop: "#4a7cc4", skyHorizon: "#f1d6a8", haze: "#b9b8b0" },
  { hours: 18.25, ambient: "#ffbe8c", skyTop: "#5a5f9e", skyHorizon: "#ff9a5a", haze: "#b98a78" },
  { hours: 19.25, ambient: "#a47ca8", skyTop: "#2c2f68", skyHorizon: "#c8607a", haze: "#6a5878" },
  { hours: 20.5, ambient: "#5f6aa2", skyTop: "#0c1233", skyHorizon: "#3a3e78", haze: "#2c3358" },
  { hours: 24, ambient: "#4c5a92", skyTop: "#050817", skyHorizon: "#18244a", haze: "#1c2848" },
];

const SUNRISE = 6;
const SUNSET = 19;

function wrapHours(hours: number): number {
  return ((hours % 24) + 24) % 24;
}

function smooth(t: number): number {
  const k = Math.min(Math.max(t, 0), 1);
  return k * k * (3 - 2 * k);
}

function blendKeys(hours: number): Key {
  for (let index = 1; index < KEYS.length; index += 1) {
    const after = KEYS[index] as Key;
    const before = KEYS[index - 1] as Key;
    if (hours <= after.hours) {
      const t = smooth((hours - before.hours) / Math.max(after.hours - before.hours, 1e-6));
      return {
        hours,
        ambient: mixHex(before.ambient, after.ambient, t),
        skyTop: mixHex(before.skyTop, after.skyTop, t),
        skyHorizon: mixHex(before.skyHorizon, after.skyHorizon, t),
        haze: mixHex(before.haze, after.haze, t),
      };
    }
  }
  return KEYS[KEYS.length - 1] as Key;
}

/**
 * The light's arc across the screen: a sun by day, a fainter moon by night.
 *
 * Both rise on the left and set on the right, and both keep a floor on their
 * height — a light exactly on the horizon would throw an infinite shadow.
 */
function lightArc(hours: number): { x: number; y: number; elevation: number } {
  const day = hours >= SUNRISE && hours <= SUNSET;
  const span = day ? SUNSET - SUNRISE : 24 - (SUNSET - SUNRISE);
  const since = day ? hours - SUNRISE : wrapHours(hours - SUNSET);
  const phase = since / span;
  const height = Math.sin(phase * Math.PI);
  const x = -Math.cos(phase * Math.PI) * 0.9;
  const y = -(0.35 + 0.65 * height);
  const length = Math.hypot(x, y);
  return { x: x / length, y: y / length, elevation: 0.2 + 0.8 * height };
}

/** How much of the light is the sun's: 1 by day, 0 by night, eased at the edges. */
function daylightAt(hours: number): number {
  const dawn = smooth((hours - (SUNRISE - 0.6)) / 1.6);
  const dusk = 1 - smooth((hours - (SUNSET - 0.9)) / 1.8);
  return Math.min(dawn, dusk);
}

/** Grey a colour toward a flat overcast value. */
function overcastTint(hex: string, overcast: number, toward: string): string {
  return mixHex(hex, toward, overcast * 0.55);
}

/** Everything the sky decides, for one moment. `overcast` is 0 clear .. 1 storm. */
export function atmosphereAt(hours: number, overcast = 0): Atmosphere {
  const wrapped = wrapHours(hours);
  const key = blendKeys(wrapped);
  const arc = lightArc(wrapped);
  const daylight = daylightAt(wrapped);
  const cloud = Math.min(Math.max(overcast, 0), 1);
  const dimmed = rgbToHex(scaleRgb(key.ambient, 1 - cloud * 0.28));
  return {
    hours: wrapped,
    daylight,
    light: { x: arc.x, y: arc.y },
    elevation: arc.elevation,
    // The moon casts too, but faintly; cloud cover softens both.
    shadowStrength: (0.25 + 0.75 * daylight) * (1 - cloud * 0.7) * Math.min(1, arc.elevation * 2.2),
    ambient: overcastTint(dimmed, cloud, "#8a93a6"),
    skyTop: overcastTint(key.skyTop, cloud, daylight > 0.5 ? "#6d7686" : "#12151f"),
    skyHorizon: overcastTint(key.skyHorizon, cloud, daylight > 0.5 ? "#9aa1ab" : "#262a36"),
    haze: overcastTint(key.haze, cloud, "#555b68"),
    starAlpha: (1 - smooth(daylight * 2.5)) * (1 - cloud),
    overcast: cloud,
  };
}

function scaleRgb(hex: string, factor: number): { r: number; g: number; b: number } {
  const { r, g, b } = hexToRgb(hex);
  return { r: r * factor, g: g * factor, b: b * factor };
}

/** The clock: where in the day `elapsedMs` of play has got to. */
export function clockHours(
  elapsedMs: number,
  startHours: number = DEFAULT_START_HOURS,
  dayMs: number = DEFAULT_DAY_MS,
): number {
  return wrapHours(startHours + (elapsedMs / Math.max(dayMs, 1)) * 24);
}

/**
 * Read `?time=` — `21`, `21.5` or `21:30` pins the clock at that hour; anything
 * unreadable leaves it running. Pinned is what a capture wants.
 */
export function parseTime(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") {
    return undefined;
  }
  const match = /^(\d{1,2})(?::(\d{2}))?$/.exec(raw.trim());
  const hours = match === null ? Number.parseFloat(raw) : Number(match[1]) + Number(match[2] ?? 0) / 60;
  return Number.isFinite(hours) && hours >= 0 && hours <= 24 ? wrapHours(hours) : undefined;
}

/** Read `?day=` — the length of a day in seconds of play. */
export function parseDayLength(raw: string | null): number {
  const seconds = raw === null ? Number.NaN : Number.parseFloat(raw);
  return Number.isFinite(seconds) && seconds >= 10 ? seconds * 1000 : DEFAULT_DAY_MS;
}
