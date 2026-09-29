/**
 * From a slime's state to the pixels of one frame: body, eyes, bubbles, the
 * melt it dies in and the shadow it lifts off.
 *
 * Pure: the layer and the asset lab both call it, which is what makes a lab
 * capture of a hop the hop the game draws. Everything a frame shows is a sum of
 * terms over time — the sim's squash spring, plus a breath, plus a look toward
 * the hero, plus a blink — never a drawn frame.
 */

import type { InkPixel, PixelCloud } from "../ink";
import type { LocalPoint } from "../planet";
import type { Offset } from "../procgen/sdf";
import { ditherThreshold } from "../shading";
import { meltCloud, pixelHash } from "../transforms";
import { DYING_MS, EMERGE_MS, MELT_MS, type Slime } from "./slime-brain";
import { slimeBody, slimeBubbles, slimeEyes, squashScale, type EyeState, SLIME_HALF_WIDTH } from "./slime-art";

export interface SlimeRenderEnv {
  /** Screen-space light direction, toward the lamp. */
  readonly light: Offset;
  readonly elapsedMs: number;
  /** The hero's local position, which the eyes follow. */
  readonly hero: LocalPoint;
  /** Screen pixels per body pixel: 1 on the field, less on the horizon roll. */
  readonly scale?: number;
  /** Horizontal shadow offset, px — the sun low on one side pushes it the other way. */
  readonly shadowShift?: number;
}

export interface SlimeFrame {
  /** Foot-anchored, lift already applied: (0, 0) is the ground under it. */
  readonly body: PixelCloud;
  readonly shadow: PixelCloud;
}

/** Breathing: a slow swell of the body while it sits, per-slime in phase. */
export function breath(slime: Slime, elapsedMs: number): number {
  if (slime.mode !== "idle") {
    return 0;
  }
  const phase = (slime.seed & 255) / 40;
  return Math.sin(elapsedMs / 230 + phase) * 0.045;
}

/** The tip leans a little one way or the other, as a per-slime trait. */
export function leanOf(seed: number): number {
  return Math.round(pixelHash(seed, 1, 0x1ea, 0) * 2 - 1);
}

/**
 * Where the eyes point, screen axes, each -1..1.
 *
 * At the hero when the slime has noticed him; otherwise a slow seeded glance
 * around, changing every couple of seconds — the "look-around" of an idle.
 */
export function gaze(slime: Slime, env: SlimeRenderEnv): { readonly x: number; readonly y: number } {
  if (slime.aware) {
    const dx = (env.hero.x - slime.local.x) * 16;
    const dy = -(env.hero.y - slime.local.y) * 12;
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length > 0.6 ? 1 : dy / length < -0.8 ? -1 : 0 };
  }
  const beat = Math.floor(env.elapsedMs / 1900 + (slime.seed & 7) / 8);
  const pick = pixelHash(beat, slime.id, slime.seed, 3);
  return { x: pick < 0.3 ? -1 : pick > 0.7 ? 1 : 0, y: pixelHash(beat, slime.id, slime.seed, 4) < 0.2 ? -1 : 0 };
}

function eyeState(slime: Slime, elapsedMs: number): EyeState {
  if (slime.mode === "hurt" || slime.mode === "dying" || slime.burnMs > 0) {
    return "squint";
  }
  const cycle = (elapsedMs + (slime.seed & 1023) * 3) % 3400;
  return cycle < 110 ? "blink" : "open";
}

/** The living figure — body, bubbles, eyes — before melt or lift. */
export function figure(slime: Slime, env: SlimeRenderEnv): PixelCloud {
  const scale = env.scale ?? 1;
  const squash = slime.mode === "dying" ? 0 : slime.squash.value + breath(slime, env.elapsedMs);
  const body = slimeBody({
    variant: slime.variant,
    squash,
    light: env.light,
    flash: slime.flashMs > 0,
    chill: slime.chillMs > 0 ? Math.min(1, slime.chillMs / 800) : 0,
    scale,
    lean: leanOf(slime.seed),
  });
  const cloud = [...body.cloud];
  if (scale < 0.6) {
    return cloud;
  }
  if (slime.mode !== "dying" && slime.flashMs <= 0) {
    cloud.push(...slimeBubbles(body, slime.variant, slime.seed, env.elapsedMs));
  }
  const look = gaze(slime, env);
  cloud.push(
    ...slimeEyes({
      squash,
      lookX: look.x,
      lookY: look.y,
      state: eyeState(slime, env.elapsedMs),
      lightX: env.light.x,
    }),
  );
  return cloud;
}

/**
 * Melt, then a puddle that dries away pixel by pixel.
 *
 * The melt is `meltCloud`, the same transform that melts the hero; the fade is
 * each puddle pixel's own seeded moment to go, so the puddle shrinks from a
 * scatter of drying spots rather than dimming as one.
 */
function dying(slime: Slime, living: PixelCloud): PixelCloud {
  const melt = Math.min(slime.modeMs / MELT_MS, 1);
  const melted = meltCloud(living, melt, slime.seed);
  const cleaned = melt > 0.5 ? melted.filter((pixel) => pixel.ink !== "void") : melted;
  if (slime.modeMs <= MELT_MS) {
    return cleaned;
  }
  const dry = (slime.modeMs - MELT_MS) / (DYING_MS - MELT_MS);
  return cleaned.filter((pixel) => pixelHash(pixel.x, pixel.y, slime.seed, 9) > dry);
}

/** A new slime rising out of a puddle of itself: the melt, played backwards. */
function emerging(slime: Slime, living: PixelCloud): PixelCloud {
  const t = Math.min(slime.modeMs / EMERGE_MS, 1);
  const eased = 1 - (1 - t) * (1 - t);
  return meltCloud(living, 1 - eased, slime.seed);
}

/**
 * A soft dithered ellipse on the ground under it.
 *
 * It shrinks as the body rises — the one cue that sells a hop's height at 1×,
 * because the body leaving its shadow is what the eye actually measures.
 */
export function slimeShadow(squash: number, lift: number, scale = 1, shift = 0): PixelCloud {
  const { sx } = squashScale(squash);
  const radiusX = (SLIME_HALF_WIDTH - 0.5) * sx * scale * (1 - Math.min(lift / 28, 0.45));
  const radiusY = Math.max(1, radiusX * 0.36);
  const shadow: PixelCloud = [];
  const reachX = Math.ceil(radiusX);
  const reachY = Math.ceil(radiusY);
  for (let y = -reachY; y <= reachY; y += 1) {
    for (let x = -reachX; x <= reachX; x += 1) {
      const e = (x / radiusX) ** 2 + (y / radiusY) ** 2;
      if (e > 1 || (e > 0.7 && ditherThreshold(x, y) < (e - 0.7) * 3)) {
        continue;
      }
      shadow.push({ x: x + Math.round(shift), y: y + 1, ink: e < 0.5 ? "shadow" : "shadow-soft" });
    }
  }
  return shadow;
}

function lifted(cloud: PixelCloud, lift: number): PixelCloud {
  const dy = Math.round(lift);
  return dy === 0 ? cloud : cloud.map((pixel): InkPixel => ({ x: pixel.x, y: pixel.y - dy, ink: pixel.ink }));
}

/** Everything one slime draws this frame, foot-anchored. */
export function slimeFrame(slime: Slime, env: SlimeRenderEnv): SlimeFrame {
  const scale = env.scale ?? 1;
  const living = figure(slime, env);
  let body = living;
  let shadowSize = 1;
  if (slime.mode === "dying") {
    body = dying(slime, living);
    shadowSize = 1 - Math.min(slime.modeMs / MELT_MS, 1);
  } else if (slime.mode === "emerge") {
    body = emerging(slime, living);
    shadowSize = Math.min(slime.modeMs / EMERGE_MS, 1);
  }
  const shadow =
    shadowSize > 0.15
      ? slimeShadow(slime.squash.value, slime.lift, scale * shadowSize, env.shadowShift ?? 0)
      : [];
  return { body: lifted(body, slime.lift * scale), shadow };
}
