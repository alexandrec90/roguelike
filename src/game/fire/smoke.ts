/**
 * Smoke: particles that are puffs rather than points.
 *
 * `fx/particles.ts` already moves smoke the right way — buoyant, dragged,
 * wandering — but draws every particle as a pixel or a shrinking 2x2, and smoke
 * does the opposite of shrinking. So the motion is the shared pool's and only
 * the drawing lives here: each live particle is a disc that **grows** and
 * **thins** as it ages, thinned by the Bayer matrix rather than by alpha, in the
 * sheer `smoke` family whose own opacity lets the world show through.
 *
 * The campfire, the fireball's trail and the explosion's column all draw
 * through `puffCloud`, so one tuning pass makes all three agree.
 */

import type { InkId, PixelCloud } from "../ink";
import { familyRamp } from "../palette";
import { type ParticlePool } from "../fx/particles";
import { ditherThreshold, rampInk } from "../shading";
import { valueNoise2 } from "../procgen/noise";

/** Sheer grey, darkest first. Young smoke is dark, old smoke pale and thin. */
export const SMOKE_RAMP: readonly InkId[] = familyRamp("smoke");

/** The largest radius a puff may grow to, logical pixels. */
export const MAX_PUFF_RADIUS = 7;

export interface PuffStyle {
  /** Radius at birth and at death, pixels. */
  readonly from: number;
  readonly to: number;
  /** Peak coverage 0..1 — the fraction of a young puff's disc that is drawn. */
  readonly density: number;
  readonly ramp?: readonly InkId[];
  /** Ramp level at birth and at death. */
  readonly levelFrom?: number;
  readonly levelTo?: number;
}

export const CAMPFIRE_SMOKE: PuffStyle = { from: 1.5, to: 5, density: 1.1, levelFrom: 0.35, levelTo: 1 };

/**
 * Drift every live particle sideways with the wind, harder the older it is.
 *
 * A column of smoke is straight where it leaves the fire and bends above it,
 * because the air near the ground is slower; weighting by age is that, for free.
 * `wind` is `windAt`'s signed value; `pxPerMs` is how far a full gust carries.
 */
export function driftPuffs(pool: ParticlePool, deltaMs: number, wind: number, pxPerMs = 0.012): void {
  const dt = Math.min(Math.max(deltaMs, 0), 50);
  for (const particle of pool.particles) {
    if (particle.active) {
      particle.x += wind * pxPerMs * dt * (0.25 + particle.ageMs / particle.lifeMs);
    }
  }
}

/**
 * Every live particle as a dithered disc, offset by `(dx, dy)`.
 *
 * Coverage falls from the middle of each disc outward and with age, and the
 * test is the ordered dither jittered by a per-puff hash — so two puffs that
 * overlap make a denser patch instead of the same pixels twice, and an old
 * puff frays into scattered pixels before it is gone.
 */
export function puffCloud(pool: ParticlePool, style: PuffStyle, dx = 0, dy = 0): PixelCloud {
  const cloud: PixelCloud = [];
  const ramp = style.ramp ?? SMOKE_RAMP;
  for (const particle of pool.particles) {
    if (!particle.active) {
      continue;
    }
    const life = particle.ageMs / particle.lifeMs;
    const radius = Math.min(style.from + (style.to - style.from) * Math.sqrt(life), MAX_PUFF_RADIUS);
    const cover = style.density * (1 - life) ** 0.8;
    const level = (style.levelFrom ?? 0.2) + ((style.levelTo ?? 0.9) - (style.levelFrom ?? 0.2)) * life;
    stampPuff(cloud, {
      x: Math.round(particle.x + dx),
      y: Math.round(particle.y + dy),
      radius,
      cover,
      level,
      ramp,
      seed: particle.seed,
    });
  }
  return cloud;
}

interface Puff {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly cover: number;
  readonly level: number;
  readonly ramp: readonly InkId[];
  readonly seed: number;
}

function stampPuff(cloud: PixelCloud, puff: Puff): void {
  const reach = Math.ceil(puff.radius);
  for (let oy = -reach; oy <= reach; oy += 1) {
    for (let ox = -reach; ox <= reach; ox += 1) {
      const d = Math.hypot(ox, oy * 1.15) / Math.max(puff.radius, 0.5);
      if (d > 1) {
        continue;
      }
      const x = puff.x + ox;
      const y = puff.y + oy;
      const coverage = puff.cover * (1 - d * d * 0.8);
      // Half ordered dither, half a coarse per-puff noise: the dither keeps the
      // thinning pixel-art, the noise breaks its checkerboard into clumps.
      const clump = valueNoise2(x / 2.2 + puff.seed, y / 2.2, puff.seed);
      const threshold = ditherThreshold(x, y) * 0.5 + clump * 0.5;
      if (coverage <= threshold) {
        continue;
      }
      // The top of a puff catches the light and its underside is in shade.
      const shade = puff.level + (oy < 0 ? 0.12 : -0.1);
      cloud.push({ x, y, ink: rampInk(puff.ramp, shade, { x, y }) });
    }
  }
}
