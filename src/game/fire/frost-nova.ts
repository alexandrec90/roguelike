/**
 * A frost nova: the worked example from `procedural-effects.md`, built.
 *
 * > An SDF ring expanding for 180 ms, an emitter of ice fragments pushed
 * > outward along the ring normal, a Voronoi crack decal held for 3 s.
 *
 * The ring is the explosion's shockwave in a cold ramp; the shards are the
 * shared particle pool, each launched along its own bearing from the ring;
 * the crack is the `frost` decal (`decals.ts`), which the layer stamps into
 * the ground and which this module also draws for the lab. Pure: a function of
 * its seed and the deltas it is stepped by, foot-anchored on the caster.
 */

import { createPool, emit, particleCloud, stepParticles, type ParticlePool, type ParticleSpec } from "../fx/particles";
import type { InkId, PixelCloud } from "../ink";
import type { LightSource } from "../lights";
import { familyHex, familyRamp } from "../palette";
import { ditherThreshold } from "../shading";
import { createDecal, decalCloud, type Decal } from "./decals";

export const NOVA_RING_MS = 180;
export const NOVA_RADIUS = 30;
/** The whole effect, crack included. */
export const NOVA_MS = 3000;
const SQUASH = 0.62;
const SHARDS = 28;

const SHARD: ParticleSpec = {
  ramp: familyRamp("frost"),
  levelFrom: 1,
  levelTo: 0.45,
  lifeMs: [260, 520],
  speed: [0.07, 0.15],
  angle: [-0.12, 0.12],
  gravity: 0.00008,
  drag: 0.006,
  size: 2,
  fade: 0.4,
};

export interface FrostNova {
  readonly seed: number;
  ageMs: number;
  readonly shards: ParticlePool;
  /** The crack, for drawing in the lab; the game stamps its own copy as a decal. */
  readonly crack: Decal;
}

export function createFrostNova(seed: number): FrostNova {
  const nova: FrostNova = {
    seed,
    ageMs: 0,
    shards: createPool(SHARDS, seed + 1),
    crack: createDecal({ x: 0, y: 0 }, "frost", seed + 2, 0),
  };
  for (let index = 0; index < SHARDS; index += 1) {
    const bearing = (index / SHARDS) * Math.PI * 2;
    // Along the ring's normal on the *ground*: a bearing on the squashed ellipse.
    const x = Math.cos(bearing) * 4;
    const y = Math.sin(bearing) * 4 * SQUASH;
    emit(nova.shards, SHARD, 1, x, y - 2, { turn: Math.atan2(Math.sin(bearing) * SQUASH, Math.cos(bearing)) });
  }
  return nova;
}

export function stepFrostNova(nova: FrostNova, deltaMs: number): void {
  const dt = Math.min(Math.max(deltaMs, 0), 50);
  nova.ageMs += dt;
  stepParticles(nova.shards, dt);
}

export function frostNovaDone(nova: FrostNova): boolean {
  return nova.ageMs >= NOVA_MS;
}

/** The ring: rime-white at its leading edge, frost behind, thinning by dither. */
export function novaRingCloud(ageMs: number): PixelCloud {
  const t = ageMs / NOVA_RING_MS;
  if (t >= 1) {
    return [];
  }
  const radius = 4 + (NOVA_RADIUS - 4) * (1 - (1 - t) ** 3);
  const width = 4 * (1 - t) + 1;
  const cover = 1 - t * t * t;
  const cloud: PixelCloud = [];
  const reachX = Math.ceil(radius + width);
  const reachY = Math.ceil((radius + width) * SQUASH);
  for (let y = -reachY; y <= reachY; y += 1) {
    for (let x = -reachX; x <= reachX; x += 1) {
      const into = (radius - Math.hypot(x, y / SQUASH)) / width;
      if (into < 0 || into > 1 || cover * (1 - into * 0.6) <= ditherThreshold(x, y)) {
        continue;
      }
      const ink: InkId = into < 0.25 ? "foam" : into < 0.6 ? "frost-4" : "frost-3";
      cloud.push({ x, y, ink });
    }
  }
  return cloud;
}

/** Crack, ring and shards, in painter's order. */
export function frostNovaCloud(nova: FrostNova): PixelCloud {
  return [...decalCloud(nova.crack, nova.ageMs), ...novaRingCloud(nova.ageMs), ...particleCloud(nova.shards)];
}

/** A cold flash: bright for the ring's life, then gone. */
export function frostNovaLight(nova: FrostNova, x: number, y: number): LightSource | null {
  const t = nova.ageMs / 360;
  if (t >= 1) {
    return null;
  }
  return { x, y: y - 4, radius: 80, color: familyHex("frost-4"), intensity: 1.1 * (1 - t) ** 2 };
}
