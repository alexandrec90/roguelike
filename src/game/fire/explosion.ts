/**
 * A fireball bursting: flash, fireball, shockwave, debris, smoke.
 *
 * `procedural-effects.md` says an impact is "hit stop, a camera impulse, and a
 * burst — all three", and a burst that reads at 320x180 needs *layers* that
 * each own a different span of the half-second:
 *
 * | ms | What carries it | Primitive |
 * | --- | --- | --- |
 * | 0–50 | a white-hot flash disc | SDF, one ink |
 * | 0–380 | the fireball: a warped blob that swells, cools down the fire ramp and tears apart into smoke | noise-sculpted SDF |
 * | 0–180 | the shockwave: a foreshortened ring racing out over the ground, thinning by dither | SDF ring |
 * | 0–600 | flame licks flung out and rising | pooled emitter |
 * | 0–900 | sparks thrown up, falling back, bouncing on the ground | pooled emitter with gravity and a floor |
 * | 60–1800 | a column of smoke rolling up and drifting | pooled emitter, drawn as puffs |
 *
 * Pure: a function of its seed and the deltas it is stepped by, in pixel
 * offsets from the foot of the blast, so the lab captures it byte for byte.
 */

import { createPool, emit, particleCloud, stepParticles, type ParticlePool, type ParticleSpec } from "../fx/particles";
import type { InkId, PixelCloud } from "../ink";
import type { LightSource } from "../lights";
import { familyHex } from "../palette";
import { fbm3 } from "../procgen/noise";
import { ditherThreshold, rampInk } from "../shading";
import { pixelHash } from "../transforms";
import { FLAME_RAMP } from "./flame";
import { driftPuffs, puffCloud, SMOKE_RAMP, type PuffStyle } from "./smoke";

/** The shockwave's life and its reach, pixels across. */
export const SHOCK_MS = 180;
export const SHOCK_RADIUS = 24;
/** The ground is foreshortened: a ring on it is this squat. */
const GROUND_SQUASH = 0.62;
const FLASH_MS = 50;
const SOOT_MS = 700;
const BLOB_MS = 380;
const BLOB_RADIUS = 11;
const SMOKE_UNTIL_MS = 520;
const PUFF_EVERY_MS = 28;
/** After this the explosion is only its smoke, and once that is gone, over. */
export const EXPLOSION_MS = 2000;

const LICK: ParticleSpec = {
  ramp: FLAME_RAMP,
  levelFrom: 1,
  levelTo: 0.05,
  lifeMs: [220, 560],
  speed: [0.05, 0.13],
  angle: [-Math.PI, Math.PI],
  gravity: -0.00012,
  drag: 0.007,
  spreadX: 3,
  spreadY: 2,
  size: 2,
  fade: 0.45,
  wobble: 0.02,
};

const DEBRIS: ParticleSpec = {
  ramp: FLAME_RAMP,
  levelFrom: 1,
  levelTo: 0.35,
  lifeMs: [520, 950],
  speed: [0.07, 0.16],
  angle: [-Math.PI + 0.25, -0.25],
  gravity: 0.00042,
  drag: 0.0015,
  spreadX: 2,
  floor: 4,
  bounce: 0.35,
  fade: 0.3,
};

const COLUMN: ParticleSpec = {
  ramp: SMOKE_RAMP,
  levelFrom: 0,
  levelTo: 0,
  lifeMs: [1000, 1700],
  speed: [0.016, 0.034],
  angle: [-Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5],
  gravity: -0.00001,
  drag: 0.0015,
  spreadX: 5,
  spreadY: 2,
  wobble: 0.015,
};

const COLUMN_PUFF: PuffStyle = { from: 2.5, to: 6.5, density: 1.25, levelFrom: 0, levelTo: 0.85 };

export interface Explosion {
  readonly seed: number;
  ageMs: number;
  readonly licks: ParticlePool;
  readonly debris: ParticlePool;
  readonly smoke: ParticlePool;
  puffCarry: number;
}

export function createExplosion(seed: number): Explosion {
  const explosion: Explosion = {
    seed,
    ageMs: 0,
    licks: createPool(36, seed + 1),
    debris: createPool(20, seed + 2),
    smoke: createPool(24, seed + 3),
    puffCarry: 0,
  };
  emit(explosion.licks, LICK, 30, 0, -5);
  emit(explosion.debris, DEBRIS, 16, 0, -3);
  return explosion;
}

/** Advance by a clamped delta; `wind` bends the smoke column. */
export function stepExplosion(explosion: Explosion, deltaMs: number, wind = 0): void {
  const dt = Math.min(Math.max(deltaMs, 0), 50);
  const before = explosion.ageMs;
  explosion.ageMs += dt;
  if (before < SMOKE_UNTIL_MS) {
    explosion.puffCarry += dt;
    while (explosion.puffCarry >= PUFF_EVERY_MS) {
      explosion.puffCarry -= PUFF_EVERY_MS;
      emit(explosion.smoke, COLUMN, 1, 0, -8 - explosion.ageMs * 0.01);
    }
  }
  stepParticles(explosion.licks, dt);
  stepParticles(explosion.debris, dt);
  stepParticles(explosion.smoke, dt);
  driftPuffs(explosion.smoke, dt, wind, 0.012);
}

export function explosionDone(explosion: Explosion): boolean {
  return explosion.ageMs >= EXPLOSION_MS;
}

function easeOut(t: number): number {
  return 1 - (1 - Math.min(Math.max(t, 0), 1)) ** 3;
}

/**
 * The shockwave: a ring on the ground, foam-white at its leading edge and
 * fire behind it, thinning to nothing through the ordered dither as it spends
 * itself. Lying flat, so it is squashed like the ground it runs over.
 */
export function shockwaveCloud(ageMs: number): PixelCloud {
  const t = ageMs / SHOCK_MS;
  if (t >= 1) {
    return [];
  }
  const radius = 3 + (SHOCK_RADIUS - 3) * easeOut(t);
  const width = 3.2 * (1 - t) + 0.9;
  const cover = 1 - t * t;
  const cloud: PixelCloud = [];
  const reachY = Math.ceil((radius + width) * GROUND_SQUASH);
  const reachX = Math.ceil(radius + width);
  for (let y = -reachY; y <= reachY; y += 1) {
    for (let x = -reachX; x <= reachX; x += 1) {
      const d = Math.hypot(x, y / GROUND_SQUASH);
      const into = (radius - d) / width;
      if (into < 0 || into > 1 || cover * (1 - into * 0.5) <= ditherThreshold(x, y)) {
        continue;
      }
      const ink: InkId = into < 0.3 ? "foam" : into < 0.65 ? "fire-6" : "fire-5";
      cloud.push({ x, y, ink });
    }
  }
  return cloud;
}

/**
 * The fireball proper: a noise-warped blob that swells fast, rises, and cools.
 *
 * Its heat falls with age and with distance from the heart, and the cool end
 * of that is not the fire ramp's dark red but smoke — so a blob that starts as
 * a white-yellow ball ends as a ragged dark cloud with a few orange seams,
 * which is what a real one does. Holes open where the noise is low, faster as
 * it cools, and those are what tear it into licks instead of letting it fade
 * as one dimming disc.
 */
export function blobCloud(ageMs: number, seed: number): PixelCloud {
  const t = ageMs / BLOB_MS;
  if (t >= 1) {
    return [];
  }
  const radius = 4 + (BLOB_RADIUS - 4) * easeOut(ageMs / 110);
  const cy = -5 - ageMs * 0.018;
  const heat = 1 - t;
  const cloud: PixelCloud = [];
  const reach = Math.ceil(radius + 2);
  for (let oy = -reach; oy <= reach; oy += 1) {
    for (let ox = -reach; ox <= reach; ox += 1) {
      const noise = fbm3(ox / 3.2, oy / 3.2 + ageMs / 90, ageMs / 140, seed, { octaves: 2 });
      const d = Math.hypot(ox, oy * 1.1) / (radius * (0.8 + noise * 0.45));
      if (d > 1 || noise < t * 0.7 - 0.05) {
        continue;
      }
      const x = ox;
      const y = Math.round(cy) + oy;
      const level = heat * (1.25 - d * 0.9) + (noise - 0.5) * 0.35 - Math.max(0, -oy / radius) * 0.15 * t;
      cloud.push({ x, y, ink: blobInk(level, x, y) });
    }
  }
  return cloud;
}

function blobInk(level: number, x: number, y: number): InkId {
  if (level > 0.22) {
    return rampInk(FLAME_RAMP, (level - 0.22) / 0.78, { x, y });
  }
  return rampInk(SMOKE_RAMP, Math.max(level, 0) / 0.22, { x, y });
}

/** The first instant: a white-hot disc that is gone before the eye resolves it. */
function flashCloud(ageMs: number): PixelCloud {
  if (ageMs >= FLASH_MS) {
    return [];
  }
  const radius = 5 + ageMs * 0.1;
  const cloud: PixelCloud = [];
  const reach = Math.ceil(radius);
  for (let y = -reach; y <= reach; y += 1) {
    for (let x = -reach; x <= reach; x += 1) {
      const d = Math.hypot(x, y) / radius;
      if (d <= 1) {
        cloud.push({ x, y: y - 5, ink: d < 0.5 ? "foam" : d < 0.72 ? "fire-6" : d < 0.86 ? "fire-5" : d < 0.94 ? "fire-4" : "fire-3" });
      }
    }
  }
  return cloud;
}

/** Scorched ground under the blast while it is still going off — soot, not the decal. */
function sootCloud(ageMs: number, seed: number): PixelCloud {
  if (ageMs < 30 || ageMs > SOOT_MS) {
    return [];
  }
  // Handing over to the scorch decal: the soot dithers out as the decal is there.
  const fading = Math.max(0, (ageMs - SOOT_MS * 0.5) / (SOOT_MS * 0.5));
  const cloud: PixelCloud = [];
  const radius = Math.min(4 + ageMs * 0.05, 9);
  for (let y = -6; y <= 6; y += 1) {
    for (let x = -10; x <= 10; x += 1) {
      const d = Math.hypot(x, y / GROUND_SQUASH) / radius;
      if (d < 1 && pixelHash(x, y, seed, 4) > d * 0.8 && fading <= ditherThreshold(x, y)) {
        cloud.push({ x, y, ink: "shadow" });
      }
    }
  }
  return cloud;
}

/** The whole burst, foot-anchored on the ground under its heart. */
export function explosionCloud(explosion: Explosion): PixelCloud {
  const age = explosion.ageMs;
  return [
    ...sootCloud(age, explosion.seed),
    ...shockwaveCloud(age),
    ...puffCloud(explosion.smoke, COLUMN_PUFF),
    ...blobCloud(age, explosion.seed),
    ...particleCloud(explosion.licks),
    ...particleCloud(explosion.debris),
    ...flashCloud(age),
  ];
}

/** A flash of light that is brightest at once and dies away in half a second. */
export function explosionLight(explosion: Explosion, x: number, y: number): LightSource | null {
  const t = explosion.ageMs / 520;
  if (t >= 1) {
    return null;
  }
  return {
    x,
    y: y - 6,
    radius: 96 - t * 30,
    color: familyHex(t < 0.2 ? "fire-6" : "fire-5"),
    intensity: 1.5 * (1 - t) ** 2,
  };
}
