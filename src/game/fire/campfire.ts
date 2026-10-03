/**
 * A campfire, as a simulation: the pure half of `campfire-layer.ts`.
 *
 * Five mechanisms composed, none of them drawn:
 *
 * | Part | Primitive |
 * | --- | --- |
 * | the stones and logs | lit SDF volumes, baked once (`campfire-parts.ts`) |
 * | the flame | the heat automaton (`flame.ts`) |
 * | the embers | a pooled, seeded emitter with buoyancy and wobble |
 * | the smoke | the same pool, drawn as growing puffs bent by the wind |
 * | the light | a flickering `LightSource`, and a dithered warm pool on the ground |
 *
 * Renderer-free, so the asset lab and the tests step exactly the fire the game
 * draws. Every cloud is foot-anchored on the middle of the pit.
 */

import { createPool, emit, particleCloud, stepParticles, type ParticlePool, type ParticleSpec } from "../fx/particles";
import type { InkId, PixelCloud } from "../ink";
import { flicker, type LightSource } from "../lights";
import { familyHex } from "../palette";
import { ditherThreshold } from "../shading";
import { pixelHash } from "../transforms";
import { buildCampfireParts, charCloud, PIT_RADIUS_X, PIT_RADIUS_Y, type CampfireParts } from "./campfire-parts";
import { createFlame, FLAME_RAMP, flameCloud, flameStrength, settleFlame, stepFlame, type Flame } from "./flame";
import { CAMPFIRE_SMOKE, driftPuffs, puffCloud } from "./smoke";

/** The flame grid: a campfire's body is about 12 wide and 20 tall. */
export const FLAME_WIDTH = 12;
export const FLAME_HEIGHT = 22;
/** Where the flame's base sits: on the logs, a little above the pit floor. */
export const FLAME_BASE_Y = -3;

/** Reach of the fire's light, logical pixels. */
export const CAMPFIRE_LIGHT_RADIUS = 70;
const LIGHT_INTENSITY = 1.1;

const EMBER_CAP = 24;
const SMOKE_CAP = 16;
const EMBER_EVERY_MS = 110;
const SMOKE_EVERY_MS = 240;

const EMBER: ParticleSpec = {
  ramp: FLAME_RAMP,
  levelFrom: 1,
  levelTo: 0.15,
  lifeMs: [700, 1700],
  speed: [0.018, 0.045],
  angle: [-Math.PI / 2 - 0.45, -Math.PI / 2 + 0.45],
  gravity: -0.000018,
  drag: 0.0012,
  spreadX: 3,
  spreadY: 2,
  fade: 0.45,
  wobble: 0.028,
};

const SMOKE: ParticleSpec = {
  ramp: FLAME_RAMP,
  levelFrom: 0,
  levelTo: 0,
  lifeMs: [2000, 3000],
  speed: [0.008, 0.014],
  angle: [-Math.PI / 2 - 0.2, -Math.PI / 2 + 0.2],
  gravity: -0.000004,
  drag: 0.0006,
  spreadX: 2,
  wobble: 0.01,
};

export interface CampfireState {
  readonly seed: number;
  readonly parts: CampfireParts;
  readonly flame: Flame;
  readonly embers: ParticlePool;
  readonly smoke: ParticlePool;
  /** Time not yet spent on an ember or a puff. */
  emberCarry: number;
  smokeCarry: number;
}

export function createCampfire(seed: number): CampfireState {
  const flame = createFlame({ width: FLAME_WIDTH, height: FLAME_HEIGHT, seed: seed + 1 });
  settleFlame(flame, 900);
  return {
    seed,
    parts: buildCampfireParts(seed),
    flame,
    embers: createPool(EMBER_CAP, seed + 2),
    smoke: createPool(SMOKE_CAP, seed + 3),
    emberCarry: 0,
    smokeCarry: 0,
  };
}

export interface CampfireDrive {
  /** Signed sideways wind at the fire, from `windAt`. */
  readonly wind: number;
  /** 0..1 rain; it damps the flame and thickens the smoke. */
  readonly rain?: number;
}

/**
 * Advance the fire by a (clamped) delta.
 *
 * Embers and puffs are emitted on a fixed cadence carried between calls, so
 * the rate does not depend on the frame rate and a capture reproduces.
 */
export function stepCampfire(state: CampfireState, deltaMs: number, drive: CampfireDrive): void {
  const dt = Math.min(Math.max(deltaMs, 0), 100);
  const rain = Math.min(Math.max(drive.rain ?? 0, 0), 1);
  stepFlame(state.flame, dt, { wind: drive.wind * 0.8, intensity: 1 - rain * 0.3 });
  const top = FLAME_BASE_Y - FLAME_HEIGHT * 0.45;

  state.emberCarry += dt;
  while (state.emberCarry >= EMBER_EVERY_MS) {
    state.emberCarry -= EMBER_EVERY_MS;
    emit(state.embers, EMBER, 1, 0, top, { inheritX: drive.wind * 0.012 });
  }
  const smokeEvery = SMOKE_EVERY_MS * (1 - rain * 0.45);
  state.smokeCarry += dt;
  while (state.smokeCarry >= smokeEvery) {
    state.smokeCarry -= smokeEvery;
    emit(state.smoke, SMOKE, 1, 0, FLAME_BASE_Y - FLAME_HEIGHT + 3);
  }
  stepParticles(state.embers, dt);
  stepParticles(state.smoke, dt);
  driftPuffs(state.embers, dt, drive.wind, 0.01);
  driftPuffs(state.smoke, dt, drive.wind, 0.016);
}

/** The flame alone, foot-anchored on the pit — what a puddle reflects. */
export function campfireFlame(state: CampfireState): PixelCloud {
  return flameCloud(state.flame).map((pixel) => ({ x: pixel.x, y: pixel.y + FLAME_BASE_Y, ink: pixel.ink }));
}

/**
 * The whole standing fire, in painter's order: far stones, logs, the glowing
 * char, the flame, the near log and stones, then embers and smoke over it all.
 */
export function campfireCloud(state: CampfireState, elapsedMs: number): PixelCloud {
  const strength = flameStrength(state.flame);
  const parts = state.parts;
  return [
    ...parts.back,
    ...parts.logs,
    ...charCloud(parts.char, elapsedMs, strength * 2.2),
    ...campfireFlame(state),
    ...parts.frontLog,
    ...parts.front,
    ...particleCloud(state.embers),
    ...puffCloud(state.smoke, CAMPFIRE_SMOKE),
  ];
}

/**
 * What lies on the ground under the fire: a bed of ash in the pit, and the warm
 * pool the flame throws on the grass around it.
 *
 * The pool is sparse on purpose — a few lit pixels thinning outward through the
 * Bayer matrix and breathing with the flicker — because the lighting pass is
 * what actually brightens the ground; this is the fire's own colour in it.
 */
export function campfireGround(state: CampfireState, elapsedMs: number): PixelCloud {
  const cloud: PixelCloud = [];
  const glow = flicker(elapsedMs, state.seed);
  const reachX = PIT_RADIUS_X * 1.9;
  const reachY = PIT_RADIUS_Y * 1.9;
  for (let y = -Math.ceil(reachY); y <= Math.ceil(reachY); y += 1) {
    for (let x = -Math.ceil(reachX); x <= Math.ceil(reachX); x += 1) {
      const pit = Math.hypot(x / (PIT_RADIUS_X - 1), (y + 1) / (PIT_RADIUS_Y - 1));
      if (pit < 1) {
        cloud.push({ x, y, ink: ashInk(x, y, pit, state.seed) });
        continue;
      }
      const d = Math.hypot(x / reachX, y / reachY);
      const warmth = (1 - d) ** 1.6 * 0.5 * glow;
      if (d < 1 && warmth > ditherThreshold(x, y) + pixelHash(x, y, state.seed, 9) * 0.15) {
        cloud.push({ x, y, ink: warmth > 0.3 ? "fire-3" : "fire-2" });
      }
    }
  }
  return cloud;
}

function ashInk(x: number, y: number, pit: number, seed: number): InkId {
  const grain = pixelHash(x, y, seed, 13);
  if (pit < 0.55 && grain > 0.82) {
    return "fire-2";
  }
  if (grain > 0.7) {
    return "smoke-3";
  }
  return pit < 0.75 ? "earth-0" : "earth-1";
}

/** The fire's light this instant, centred a little above the pit. */
export function campfireLight(state: CampfireState, elapsedMs: number, footX: number, footY: number): LightSource {
  const strength = Math.min(flameStrength(state.flame) * 3, 1);
  return {
    x: footX,
    y: footY - 8,
    radius: CAMPFIRE_LIGHT_RADIUS,
    color: familyHex("fire-4"),
    intensity: LIGHT_INTENSITY * flicker(elapsedMs, state.seed) * (0.7 + 0.3 * strength),
  };
}
