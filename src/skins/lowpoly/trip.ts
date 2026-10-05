/**
 * The trip: one dial, 0..1, that every psychedelic term in this skin reads, so
 * the world can slide from sober into strange rather than switch.
 *
 * Always on with the dial, each a function of time and place:
 *
 * - **Colour that moves** (fragment). Every lit colour is turned about the grey
 *   axis by an angle summed from rings that spread out from the hero, the
 *   facet's own normal (so each triangle flips colour as the planet turns under
 *   it), and a slow drift the sky shares. Then saturated, and cast with the hue
 *   so even a grey trips.
 * - **A world that breathes** (vertex). The ground swells in two slow waves
 *   pinned to the planet, and every body rides the swell at its foot and
 *   swells about it on a shared beat that pulses outward from the hero. Both are
 *   read at the body's *anchor*, so a body moves as one and never shears.
 * - **Puddles that show somewhere else.** The mirror pass is turned a further
 *   half-circle of hue, its empty sky with it.
 *
 * And five more, each its own `?fx=` switch (`TRIP_FX`), all on by default:
 *
 * | Switch | What | Where |
 * | --- | --- | --- |
 * | `haze` | the far field's haze takes a hue from its bearing, so turning sweeps a sunset round the horizon | fragment |
 * | `neon` | edges turned away from the viewer glow in a cycling neon, brighter at night | fragment |
 * | `curl` | the horizon lip rises past the horizon line like a wave about to break, rolling across the screen | vertex |
 * | `sky` | the world drawn again, upside down about the horizon line, so the planet hangs overhead | one more draw of the field |
 * | `trails` | each frame keeps a fading, zoomed, hue-turned copy of the last: everything smears outward | one full-screen pass |
 *
 * A skin decides how things look, never what happens: nothing here reaches the
 * simulation. At 0 every term is exactly the identity, so `?trip=0` is the skin
 * as it was.
 *
 * This file is the CPU reference; `trip-shaders.ts` writes the same terms in
 * GLSL and WGSL from the constants here. Change one, change all three.
 */

import type { Atmosphere } from "../../game/atmosphere";
import { PLANET_TILES } from "../../game/planet";
import { TILE_DEPTH, WALL_RISE } from "../../game/projection";
import type { FrameUniforms } from "./backend";
import { rgb, type Rgb } from "./mesh";
import { CLOCK_WRAP_S } from "./wet-world";

const TAU = Math.PI * 2;

/**
 * Radians a second for something that turns `cycles` times a shader-clock lap.
 * A whole number of cycles a lap is what keeps a term from jumping when the
 * clock wraps (`shaderSeconds`).
 */
const perSecond = (cycles: number): number => (TAU * cycles) / CLOCK_WRAP_S;

/** Toward the viewer in the local frame: the ray along which the oblique projection does not move a point. */
const VIEW_LENGTH = Math.hypot(WALL_RISE, TILE_DEPTH);

/** Every tuning the terms read, in one place, so the shaders are written from the same numbers. */
export const TRIP = {
  /** Tiles between one ring of colour and the next, and how fast they spread: one every 3 s. */
  ringTiles: 9,
  ringRate: perSecond(200),
  /** How far a ring swings the hue either way, and a facet's tilt, radians. */
  hueSwing: 1.6,
  facetSwing: 1.4,
  /** The slow drift the sky shares: a lap of the hue wheel every 50 s. */
  driftRate: perSecond(12),
  /** Extra saturation, and the hue cast laid over everything (a grey would never trip without it). */
  saturate: 0.55,
  cast: 0.35,
  /** Tiles the ground rises and falls; the swell's two waves, in whole cycles round the planet. */
  swellTiles: 0.45,
  swellA: { kx: 20, ky: 9, rate: perSecond(150), weight: 0.6 },
  swellB: { kx: -7, ky: 23, rate: perSecond(110), weight: 0.4 },
  /** How far a body swells about its foot, on a beat every 3 s that lags outward from the hero. */
  breath: 0.08,
  beatRate: perSecond(200),
  beatSpread: 0.35,
  /** The hue turn the mirror adds: the complementary colours. */
  mirrorTurn: Math.PI,
  /** `haze`: radians of hue a bearing east, and north, turns the haze. */
  hazeX: 2.4,
  hazeY: 1.1,
  /** `neon`: the glow's strength, how its hue spreads and cycles, and the way the viewer looks. */
  neonGain: 0.9,
  neonSpread: 0.25,
  neonRate: perSecond(150),
  view: [0, -WALL_RISE / VIEW_LENGTH, TILE_DEPTH / VIEW_LENGTH] as Rgb,
  /** `curl`: how far past the horizon line the lip rises, a share of its height, and its wave across the screen. */
  // At 0.9 the lip swallowed the whole sky band, and the overhead world with it.
  curl: 0.45,
  curlK: 0.16,
  curlRate: perSecond(100),
  /** `sky`: the share of the depth range the overhead world sits behind, and how much of the haze it is seen through. */
  skyDepth: 0.95,
  skyHaze: 0.4,
  /** `trails`: what share of the last frame stays, how much it zooms and spins, and its hue turn, per frame. */
  trailKeep: 0.6,
  trailZoom: 0.014,
  trailSpin: 0.005,
  trailHue: 0.12,
} as const;

/** The `?fx=` switches, as the bits the shaders read. */
export const TRIP_FX = { haze: 1, neon: 2, curl: 4, sky: 8, trails: 16 } as const;

export type TripFx = keyof typeof TRIP_FX;

/** Every switch at once. */
const ALL_FX = Object.values(TRIP_FX).reduce((all, bit) => all | bit, 0);

/**
 * `?trip=` - how far gone, 0..1. Bare (`?trip`) is all the way; a number is
 * clamped; anything else, or nothing, is sober. Never throws: a typo starts the
 * game as it was.
 */
export function parseTrip(raw: string | null): number {
  if (raw === null) {
    return 0;
  }
  const text = raw.trim();
  if (text === "") {
    return 1;
  }
  const value = Number(text);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

/**
 * `?fx=` - which of the five extra terms run, as `TRIP_FX` bits: a comma list
 * (`fx=sky,trails`), `all`, or `none`. Absent or empty is all of them; an
 * unknown name is skipped rather than failing the rest.
 */
export function parseFx(raw: string | null): number {
  const names = (raw ?? "").split(",").map((name) => name.trim().toLowerCase()).filter((name) => name !== "");
  if (names.length === 0 || names.includes("all")) {
    return ALL_FX;
  }
  return names.reduce((bits, name) => bits | (TRIP_FX[name as TripFx] ?? 0), 0);
}

/** Whether a switch is on in `fx`. */
export function hasFx(fx: number, name: TripFx): boolean {
  return (fx & TRIP_FX[name]) !== 0;
}

/**
 * `colour` turned `angle` radians about the grey axis (Rodrigues' rotation):
 * a hue rotation that keeps r + g + b, and leaves a grey grey. A third of a
 * turn takes red to green. Not clamped - a turned colour can leave the cube.
 */
export function hueTurn(colour: Rgb, angle: number): Rgb {
  const [r, g, b] = colour;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle) / Math.sqrt(3);
  const grey = ((r + g + b) / 3) * (1 - cos);
  return [r * cos + (b - g) * sin + grey, g * cos + (r - b) * sin + grey, b * cos + (g - r) * sin + grey];
}

/**
 * `colour` turned by `angle`, saturated by `amount`, and cast with the hue at
 * `angle` - a red cast turned with it, which sums to zero, so it tints without
 * brightening - then back inside the cube's floor.
 */
export function tripTint(colour: Rgb, amount: number, angle: number): Rgb {
  const turned = hueTurn(colour, angle);
  const luma = turned[0] * 0.299 + turned[1] * 0.587 + turned[2] * 0.114;
  const k = 1 + TRIP.saturate * amount;
  const cast = hueTurn([1, -0.5, -0.5], angle);
  const tint = TRIP.cast * amount * luma;
  const channel = (i: 0 | 1 | 2): number => Math.max(luma + (turned[i] - luma) * k + cast[i] * tint, 0);
  return [channel(0), channel(1), channel(2)];
}

/**
 * The hue angle at a fragment: `away` is its planet offset from the hero,
 * `normal` its face normal in the local frame, `mirrored` true in the mirror pass.
 */
export function tripHue(amount: number, seconds: number, away: readonly [number, number], normal: Rgb, mirrored: boolean): number {
  const ring = Math.sin((Math.hypot(away[0], away[1]) * TAU) / TRIP.ringTiles - seconds * TRIP.ringRate);
  const facet = normal[0] * 0.9 + normal[1] * 0.6;
  const turn = TRIP.hueSwing * ring + TRIP.facetSwing * facet + seconds * TRIP.driftRate + (mirrored ? TRIP.mirrorTurn : 0);
  return amount * turn;
}

/** Tiles the ground stands raised at a planet point. Pinned to the planet, seamless round the wrap. */
export function tripSwell(amount: number, seconds: number, planet: readonly [number, number]): number {
  const wave = (w: typeof TRIP.swellA | typeof TRIP.swellB): number =>
    w.weight * Math.sin((TAU * (w.kx * planet[0] + w.ky * planet[1])) / PLANET_TILES - seconds * w.rate);
  return amount * TRIP.swellTiles * (wave(TRIP.swellA) + wave(TRIP.swellB));
}

/** How much a body is scaled about its foot, `away` tiles from the hero: 1 when sober. */
export function tripBreath(amount: number, seconds: number, away: readonly [number, number]): number {
  return 1 + amount * TRIP.breath * Math.sin(seconds * TRIP.beatRate - Math.hypot(away[0], away[1]) * TRIP.beatSpread);
}

/** `haze`: the hue turn of the haze at a bearing from the hero (`away`, planet frame); 0 at the hero himself. */
export function tripHazeTurn(amount: number, away: readonly [number, number]): number {
  const length = Math.hypot(away[0], away[1]);
  return length === 0 ? 0 : (amount * (TRIP.hazeX * away[0] + TRIP.hazeY * away[1])) / length;
}

/**
 * `neon`: the glow added to a face - strongest on faces turned edge-on to the
 * viewer, in a hue that cycles outward from the hero, brighter as the day goes.
 */
export function tripNeon(amount: number, seconds: number, away: readonly [number, number], normal: Rgb, daylight: number): Rgb {
  const view = TRIP.view;
  const facing = Math.max(normal[0] * view[0] + normal[1] * view[1] + normal[2] * view[2], 0);
  const rim = (1 - facing) ** 3;
  const phase = Math.hypot(away[0], away[1]) * TRIP.neonSpread - seconds * TRIP.neonRate;
  const k = amount * TRIP.neonGain * rim * (0.7 + 0.9 * (1 - daylight));
  const channel = (offset: number): number => (0.5 + 0.5 * Math.cos(phase + offset)) * k;
  return [channel(0), channel(TAU / 3), channel((2 * TAU) / 3)];
}

/**
 * `curl`: how far past its own height the lip rises at `footX` tiles across,
 * as a share of it. The lip's lift becomes `lift + curl · lift²`, which keeps
 * the seam with the flat field crease-free (the slope at lift 0 is unchanged)
 * while its far edge climbs over the horizon line.
 */
export function tripCurl(amount: number, seconds: number, footX: number): number {
  return amount * TRIP.curl * (0.55 + 0.45 * Math.sin(footX * TRIP.curlK - seconds * TRIP.curlRate));
}

/** `sky`: a 0..1 depth into the share of the range its pass owns - the overhead world behind everything else. */
export function tripDepth(depth: number, overhead: boolean): number {
  return overhead ? TRIP.skyDepth + (1 - TRIP.skyDepth) * depth : TRIP.skyDepth * depth;
}

/** `trails` for one frame: what it does to the last, and about where. */
export interface TrailFrame {
  /** Share of the last frame that stays, its zoom and spin (radians), its hue turn (radians). */
  readonly keep: number;
  readonly zoom: number;
  readonly spin: number;
  readonly hue: number;
  /** The hero's foot as a share of the screen, from the top left: what the smear streams away from. */
  readonly centre: readonly [number, number];
  /** The drawing buffer, device pixels. */
  readonly width: number;
  readonly height: number;
}

/** `trails` this frame, or nothing when sober or switched off. */
export function trailFrame(frame: Pick<FrameUniforms, "trip" | "fx" | "view" | "width" | "height">): TrailFrame | undefined {
  const amount = frame.trip;
  if (amount <= 0 || !hasFx(frame.fx, "trails")) {
    return undefined;
  }
  return {
    keep: TRIP.trailKeep * amount,
    zoom: TRIP.trailZoom * amount,
    spin: TRIP.trailSpin * amount,
    hue: TRIP.trailHue * amount,
    centre: [frame.view.footX / frame.view.width, frame.view.footY / frame.view.height],
    width: frame.width,
    height: frame.height,
  };
}

/** The sky drifted with the world: its two colours turned by the drift alone. The light and the haze are left be. */
export function trippedAtmosphere(atmosphere: Atmosphere, amount: number, seconds: number): Atmosphere {
  if (amount <= 0) {
    return atmosphere;
  }
  const angle = amount * seconds * TRIP.driftRate;
  return {
    ...atmosphere,
    skyTop: hexOf(tripTint(rgb(atmosphere.skyTop), amount, angle)),
    skyHorizon: hexOf(tripTint(rgb(atmosphere.skyHorizon), amount, angle)),
  };
}

/** The empty sky the mirror is cleared to: turned as the mirror pass's fragments are, past the drift already in it. */
export function tripMirrorSky(sky: Rgb, amount: number): Rgb {
  const [r, g, b] = hueTurn(sky, amount * TRIP.mirrorTurn);
  return [Math.max(r, 0), Math.max(g, 0), Math.max(b, 0)];
}

/** `#rrggbb` from 0..1 channels, clamped. */
export function hexOf(colour: Rgb): string {
  const byte = (v: number): string => Math.round(Math.min(Math.max(v, 0), 1) * 255).toString(16).padStart(2, "0");
  return `#${byte(colour[0])}${byte(colour[1])}${byte(colour[2])}`;
}
