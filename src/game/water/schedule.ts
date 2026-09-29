/**
 * The weather, as a pure function of the clock.
 *
 * `lightningAt` already showed the shape this wants: a storm the scene has to
 * *remember* cannot be captured at a fixed `t`, and one that is a function of
 * `(elapsed, seed)` can. So the sky here keeps no state at all. Time is cut
 * into fixed cycles, and each cycle is one spell of weather dealt from its own
 * seed — how long it drizzles, how hard it then rains, whether that rain is a
 * thunderstorm, how long it stays clear afterwards:
 *
 *     drizzle → rain (sometimes a storm) → clearing → clear → clouding over → …
 *
 * A cycle **opens** on the drizzle and **closes** on the clouding over, so the
 * seam between two cycles lands in the middle of a grey sky rather than in the
 * middle of a downpour, and every ramp is a smoothstep, so nothing in the
 * picture that reads these numbers ever jumps.
 *
 * It opens on the drizzle for a second reason: a game that loads onto two clear
 * minutes has hidden its weather from anyone who looks for ten seconds.
 *
 * The one piece of weather that *is* state is how wet the ground has got,
 * because wetness is an integral of the rain over time and drying is slow —
 * `stepWetness` is that integrator, and the layer owns the number.
 */

import { pixelHash } from "../transforms";

export interface WeatherState {
  /** 0..1: how hard it is raining. 0 is dry, 0.3 a drizzle, 1 a downpour. */
  readonly rain: number;
  /** 0 clear .. 1 fully overcast. What the atmosphere greys the sky by. */
  readonly overcast: number;
  /** Lightning only strikes while this holds. */
  readonly storm: boolean;
  /** Multiplies the rain's slant and the wind's strength; 1 is a breezy day. */
  readonly wind: number;
}

/** One spell of weather, start to finish. */
export const WEATHER_CYCLE_MS = 5 * 60 * 1000;

/** The seed the scene uses unless it asks for another. */
export const WEATHER_SEED = 0x7e3a;

/** How much of the cycles become thunderstorms. The first always does. */
const STORM_CHANCE = 0.4;

/** Overcast while it drizzles; the seams between cycles are pinned to it. */
const GREY = 0.68;

/** Clear skies are not cloudless. */
const FAIR = 0.08;

interface Spell {
  readonly drizzleMs: number;
  readonly rainMs: number;
  readonly clearingMs: number;
  readonly cloudingMs: number;
  readonly peakRain: number;
  readonly peakOvercast: number;
  readonly storm: boolean;
}

/** The dealt shape of one cycle; everything in it is a seeded draw. */
function spellOf(cycle: number, seed: number): Spell {
  const draw = (salt: number): number => pixelHash(cycle, salt, seed, 0x5eed);
  const storm = cycle === 0 || draw(1) < STORM_CHANCE;
  return {
    drizzleMs: 22_000 + draw(2) * 18_000,
    rainMs: storm ? 80_000 + draw(3) * 40_000 : 50_000 + draw(3) * 50_000,
    clearingMs: 24_000 + draw(4) * 12_000,
    cloudingMs: 28_000 + draw(5) * 16_000,
    peakRain: storm ? 1 : 0.5 + draw(6) * 0.35,
    peakOvercast: storm ? 1 : 0.8 + draw(7) * 0.12,
    storm,
  };
}

function smooth(t: number): number {
  const k = Math.min(Math.max(t, 0), 1);
  return k * k * (3 - 2 * k);
}

function mix(from: number, to: number, t: number): number {
  return from + (to - from) * smooth(t);
}

/**
 * Wind rises with the rain, and harder still as a storm builds. `squall` is
 * how far into a storm the sky is, 0..1, rather than the storm flag itself, so
 * the wind leans in over the ramp instead of stepping when lightning arms.
 */
function state(rain: number, overcast: number, storm: boolean, squall = storm ? 1 : 0): WeatherState {
  return { rain, overcast, storm, wind: 0.7 + rain * 0.7 + squall * 0.35 };
}

/**
 * The rain phase: ramp up to the spell's peak over its first quarter, hold,
 * and ease back to a drizzle over its last fifth. A storm is the held part of
 * a storm spell, so the lightning never flickers at the edges of a shower.
 */
function rainPhase(spell: Spell, sinceMs: number): WeatherState {
  const t = sinceMs / spell.rainMs;
  const rise = smooth(t / 0.25);
  const fall = smooth((t - 0.8) / 0.2);
  const level = rise * (1 - fall);
  const rain = 0.3 + (spell.peakRain - 0.3) * level;
  const overcast = GREY + 0.07 + (spell.peakOvercast - GREY - 0.07) * level;
  return state(rain, overcast, spell.storm && level > 0.7, spell.storm ? level : 0);
}

/**
 * The weather at `elapsedMs` of play. Pure: the same (time, seed) is the same
 * sky, in a test, in the lab and in the game.
 */
/**
 * A session opens on a fair sky and holds it this long before the first cycle
 * begins — the last half-minute of it clouding over — so a player's first look
 * at the world is in sunlight, and the weather arrives rather than being there.
 */
export const FAIR_OPENING_MS = 100_000;
const OPENING_CLOUDING_MS = 30_000;

export function weatherAt(elapsedMs: number, seed: number = WEATHER_SEED): WeatherState {
  const opening = Math.max(elapsedMs, 0);
  if (opening < FAIR_OPENING_MS) {
    const clouding = (opening - (FAIR_OPENING_MS - OPENING_CLOUDING_MS)) / OPENING_CLOUDING_MS;
    return state(0, mix(FAIR, GREY, clouding), false);
  }
  const time = opening - FAIR_OPENING_MS;
  const cycle = Math.floor(time / WEATHER_CYCLE_MS);
  const spell = spellOf(cycle, seed);
  let since = time - cycle * WEATHER_CYCLE_MS;

  if (since < spell.drizzleMs) {
    const t = since / spell.drizzleMs;
    return state(mix(0, 0.3, t), mix(GREY, GREY + 0.07, t), false);
  }
  since -= spell.drizzleMs;
  if (since < spell.rainMs) {
    return rainPhase(spell, since);
  }
  since -= spell.rainMs;
  if (since < spell.clearingMs) {
    const t = since / spell.clearingMs;
    return state(mix(0.3, 0, t), mix(GREY + 0.07, FAIR, t), false);
  }
  since -= spell.clearingMs;
  const cloudingFrom = WEATHER_CYCLE_MS - spell.drizzleMs - spell.rainMs - spell.clearingMs;
  const clearMs = Math.max(cloudingFrom - spell.cloudingMs, 0);
  if (since < clearMs) {
    return state(0, FAIR, false);
  }
  return state(0, mix(FAIR, GREY, (since - clearMs) / spell.cloudingMs), false);
}

/** Fixed skies, for `?weather=` and for a capture that must not change under it. */
export const WEATHER_PRESETS = {
  clear: state(0, FAIR, false),
  overcast: state(0, 0.8, false),
  drizzle: state(0.3, 0.75, false),
  rain: state(0.75, 0.88, false),
  storm: state(1, 1, true),
} as const satisfies Record<string, WeatherState>;

export type WeatherPreset = keyof typeof WEATHER_PRESETS;

/**
 * Read `?weather=` — a preset name pins the sky; anything else (or nothing)
 * leaves the schedule running.
 */
export function parseWeather(raw: string | null): WeatherState | undefined {
  if (raw === null) {
    return undefined;
  }
  const key = raw.trim().toLowerCase();
  return key in WEATHER_PRESETS ? WEATHER_PRESETS[key as WeatherPreset] : undefined;
}

/** The ground's soaking time constant at a rain level of 1, ms (slower in a drizzle). */
const SOAK_MS = 12_000;

/** How fast it dries with no rain, per ms: dry again in ~2 minutes. */
const DRY_PER_MS = 1 / 120_000;

/**
 * Advance how wet the ground is, 0..1.
 *
 * Rain pulls wetness *up toward* the rain level — a drizzle never floods the
 * field — at a rate that scales with how hard it falls; with no rain on it the
 * ground dries at a slow constant rate. The asymmetry is the point: puddles
 * outlast the shower that filled them.
 */
export function stepWetness(wetness: number, rain: number, deltaMs: number): number {
  const delta = Math.min(Math.max(deltaMs, 0), 1000);
  const current = Math.min(Math.max(wetness, 0), 1);
  const target = Math.min(Math.max(rain, 0), 1) * 1.15;
  if (target > current) {
    const pull = Math.min(1, (delta * (0.4 + rain)) / SOAK_MS);
    return Math.min(current + (target - current) * pull, 1);
  }
  return Math.max(current - DRY_PER_MS * delta, Math.min(target, current));
}

/**
 * How big the field's puddles are for a given wetness: 0.8x bone dry, 1.1x
 * soaked. Stepped in quarters rather than continuous, because a puddle is
 * re-grown whenever its size changes, and a rim that crept outward a pixel at a
 * time would re-seed its outline every few seconds.
 */
export function puddleScale(wetness: number): number {
  return 0.8 + 0.1 * Math.round(Math.min(Math.max(wetness, 0), 1) * 3);
}
