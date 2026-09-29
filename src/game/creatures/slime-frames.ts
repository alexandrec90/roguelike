/**
 * Slime filmstrips for the asset lab, sampled from the real simulation.
 *
 * Nothing here is drawn. Each strip runs a slime through `slime-brain.ts` or
 * the whole `slime-sim.ts` — a hop, a hit, a death — at fixed steps and
 * flattens `slimeFrame` at each, so what the lab shows is exactly the code
 * path the game runs, particles included.
 */

import type { Strike } from "../combat";
import { createPool, particleCloud, stepParticles } from "../fx/particles";
import { cloudToSprite, inkHex, INK_TOKENS, type CloudFrame, type InkId, type PixelCloud } from "../ink";
import { familyRamp, type Family } from "../palette";
import type { PaletteVariant } from "../asset-types";
import type { PixelSpriteSource } from "../pixel-art";
import type { PlanetPose } from "../planet";
import { createSlime, stepSlime, type BrainWorld, type Slime } from "./slime-brain";
import { emitDeathGoo, emitHitGoo, emitLanding } from "./slime-fx";
import { hopHeight } from "./slime-motion";
import type { SlimeVariant } from "./slime-palette";
import { slimeFrame, type SlimeRenderEnv } from "./slime-render";
import { createSlimeSim, spawnSlime, stepSlimes } from "./slime-sim";

/** Room for a hop's height above and a knockback or a hop's travel to the right. */
export const SLIME_LAB_FRAME: CloudFrame = { width: 48, height: 36, originX: 16, originY: 28 };

const LIGHT = { x: -0.6, y: -0.8 };
const STEP_MS = 16;

function env(elapsedMs: number, overrides: Partial<SlimeRenderEnv> = {}): SlimeRenderEnv {
  return { light: LIGHT, elapsedMs, hero: { x: -4, y: -1 }, ...overrides };
}

/** One lab frame: shadow, particles, body, all at the slime's own offset from the frame origin. */
function compose(
  slime: Slime,
  renderEnv: SlimeRenderEnv,
  offsetX: number,
  particles: PixelCloud,
): PixelCloud {
  const drawn = slimeFrame(slime, renderEnv);
  const shift = (cloud: PixelCloud): PixelCloud => cloud.map((p) => ({ x: p.x + offsetX, y: p.y, ink: p.ink }));
  return [...shift(drawn.shadow), ...particles, ...shift(drawn.body)];
}

const FAR_WORLD: BrainWorld = { hero: { x: 100, y: 100 }, blocked: () => false, others: [] };

/** Idle: breathing, a blink and a glance around, `count` frames `stepMs` apart. */
export function idleFrames(variant: SlimeVariant, count: number, stepMs: number): PixelSpriteSource[] {
  const slime = createSlime(1, { x: 0, y: 0 }, 0x2a7, variant);
  slime.waitMs = Number.POSITIVE_INFINITY;
  return Array.from({ length: count }, (_unused, index) =>
    cloudToSprite(compose(slime, env(index * stepMs + 3300), 0, []), SLIME_LAB_FRAME),
  );
}

/** One hop to the right and the wobble after it, sampled every `stepMs`. */
export function hopFrames(variant: SlimeVariant, stepMs: number): PixelSpriteSource[] {
  const slime = createSlime(1, { x: 0, y: 0 }, 0x2a7, variant, { mode: "hop" });
  const pool = createPool(24, 0x51);
  slime.hopFrom = { x: 0, y: 0 };
  slime.hopTo = { x: 1, y: 0 };
  slime.hopHeight = hopHeight(1);
  const frames: PixelSpriteSource[] = [];
  for (let elapsed = 0; elapsed <= 1150; elapsed += STEP_MS) {
    const outcome = stepSlime(slime, { ...FAR_WORLD }, STEP_MS);
    if (slime.mode === "idle") {
      slime.waitMs = Number.POSITIVE_INFINITY;
    }
    const offsetX = Math.round(slime.at.x * 16);
    if (outcome.landed) {
      emitLanding(pool, variant);
    }
    stepParticles(pool, STEP_MS);
    if (elapsed % stepMs === 0) {
      // The splat went off where it landed, one tile (16 px) right of the start.
      const particles = particleCloud(pool, 16, 0);
      frames.push(cloudToSprite(compose(slime, env(elapsed), offsetX, particles), SLIME_LAB_FRAME));
    }
  }
  return frames;
}

/**
 * A blow from the left, through the whole sim: flash, squint, knockback, goo,
 * recovery — or, with `lethal`, the melt and the puddle drying away.
 */
export function strikeFrames(variant: SlimeVariant, lethal: boolean, stepMs: number, durationMs: number): PixelSpriteSource[] {
  const sim = createSlimeSim({ blocked: () => false });
  const pose: PlanetPose = { x: 200, y: 40, turn: 0 };
  // Past the sweep's first pass there is nothing to stock: the dens near this
  // spot are left alone by holding the sweep off for the length of the strip.
  sim.sweepMs = Number.POSITIVE_INFINITY;
  const slime = spawnSlime(sim, { x: 201, y: 40 }, { seed: 0x2a7, variant });
  slime.waitMs = Number.POSITIVE_INFINITY;
  const pool = createPool(40, 0x77);
  const strike: Strike = { at: { x: 0.4, y: 0 }, radius: 1, damage: lethal ? 3 : 1, element: "steel", push: { x: 3.2, y: 0 } };
  const frames: PixelSpriteSource[] = [];
  for (let elapsed = 0; elapsed <= durationMs; elapsed += STEP_MS) {
    const events = stepSlimes(sim, { pose, hero: { x: 0, y: 0 }, strikes: elapsed === 64 ? [strike] : [], deltaMs: STEP_MS });
    for (const hit of events.hits) {
      emitHitGoo(pool, variant, hit.push.x, -hit.push.y);
    }
    if (events.deaths.length > 0) {
      emitDeathGoo(pool, variant);
    }
    if (slime.mode === "idle") {
      slime.waitMs = Number.POSITIVE_INFINITY;
    }
    stepParticles(pool, STEP_MS);
    if (elapsed % stepMs === 0) {
      const offsetX = Math.round((slime.at.x - 201) * 16);
      frames.push(cloudToSprite(compose(slime, env(elapsed, { hero: { x: 0, y: 0 } }), offsetX, particleCloud(pool)), SLIME_LAB_FRAME));
    }
  }
  return frames;
}

/** A restocked den: the slime rising out of a puddle of itself. */
export function emergeFrames(variant: SlimeVariant, count: number, stepMs: number): PixelSpriteSource[] {
  const slime = createSlime(1, { x: 0, y: 0 }, 0x2a7, variant, { mode: "emerge" });
  slime.waitMs = Number.POSITIVE_INFINITY;
  return Array.from({ length: count }, (_unused, index) => {
    stepSlime(slime, FAR_WORLD, index === 0 ? 0 : stepMs);
    return cloudToSprite(compose(slime, env(index * stepMs), 0, []), SLIME_LAB_FRAME);
  });
}

/**
 * A palette variant that re-inks one family as another, step for step.
 *
 * Only tokens present in every frame are overridden — the registry rejects a
 * swap that targets a token some frame lacks — and the hex comes from the
 * target ink, so a swap is still inks, never an invented colour.
 */
export function familySwap(
  frames: readonly PixelSpriteSource[],
  from: Family,
  to: Family,
  label: string,
): PaletteVariant {
  const source = familyRamp(from);
  const target = familyRamp(to);
  const overrides: Record<string, string> = {};
  source.forEach((ink, index) => {
    const token = INK_TOKENS[ink];
    if (frames.every((frame) => token in frame.palette)) {
      overrides[token] = inkHex(target[Math.min(index, target.length - 1)] as InkId);
    }
  });
  return { id: `as-${to}`, label, overrides };
}
