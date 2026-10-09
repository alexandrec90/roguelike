/**
 * Painting the water into pixel buffers: the still body (baked), and
 * everything that moves on it (every frame).
 *
 * Renderer-free on purpose — `water-layer.ts` owns the textures and the
 * coordinate bookkeeping, and this owns what goes into them — so the whole of
 * a frame of water can be painted and read back in a test.
 *
 * Every coordinate here is the **zero-phase grid** the puddles were grown on,
 * and `margin` is where that grid's (0, 0) sits inside the buffer. Anything
 * arriving from screen space (a reflection's foot, a drop) has already had the
 * scroll offset taken off by the layer.
 */

import type { PixelCloud } from "../ink";
import { clearBuffer, paintInto, type PixelBuffer } from "../pixel-buffer";
import { puddleGlints, type Puddle } from "../puddles";
import { rippleAlpha, rippleCloud, type RippleField } from "../ripples";
import { puddleBody, relativeBody } from "./body";
import { clipToMask, type WaterMask } from "./mask";
import { reflectionCloud, type Reflectable } from "./reflect";
import type { SkyReflection } from "./sky-inks";

/** What one frame of water is drawn from. */
export interface WaterScene {
  readonly puddles: readonly Puddle[];
  readonly mask: WaterMask;
  readonly sky: SkyReflection;
}

/** How the surface is disturbed this frame. */
export interface SurfaceMotion {
  readonly elapsedMs: number;
  /** 0..1: roughens reflections and quiets the glints. */
  readonly rain: number;
  /** 0..1: a lightning strike lighting the water from above. */
  readonly strike: number;
  /** False leaves out the sky's glints (`?off=reflections`); true when absent. */
  readonly glints?: boolean;
}

/** A reflection is always dimmer than what it reflects — and sits *in* the water, over the sky in it. */
export const REFLECTION_ALPHA = 0.82;

/** The sky's glint on still water; rain on the surface breaks most of it up. */
const GLINT_ALPHA = 0.9;

/** How much of a strike's light the water throws back. */
const STRIKE_GAIN = 0.6;

/** Clear `buffer` and paint every puddle's still body into it. */
export function paintBodies(buffer: PixelBuffer, scene: WaterScene): void {
  clearBuffer(buffer);
  const margin = scene.mask.margin;
  for (const puddle of scene.puddles) {
    const { centerX, centerY } = puddle;
    // The cached body painted at its centre, rather than a copy of it moved there.
    if (Number.isInteger(centerX) && Number.isInteger(centerY)) {
      paintInto(buffer, relativeBody(puddle, scene.sky), margin + centerX, margin + centerY);
    } else {
      paintInto(buffer, puddleBody(puddle, scene.sky), margin, margin);
    }
  }
}

/**
 * Everything that moves on the water, in the order light reaches the eye:
 * the sky's glint, what stands over it, the rings the rain punched, and a
 * lightning flash over the lot. Does not clear — the caller decides whether
 * this frame starts from nothing.
 */
export function paintSurface(
  buffer: PixelBuffer,
  scene: WaterScene,
  ripples: RippleField,
  reflect: readonly Reflectable[],
  motion: SurfaceMotion,
): void {
  const margin = scene.mask.margin;
  const rain = Math.min(Math.max(motion.rain, 0), 1);

  const glintAlpha = GLINT_ALPHA * (1 - 0.65 * rain);
  for (const puddle of motion.glints === false ? [] : scene.puddles) {
    paintInto(buffer, puddleGlints(puddle, motion.elapsedMs, scene.sky.glint), margin, margin, glintAlpha);
  }

  for (const thing of reflect) {
    const image = reflectionCloud(thing.cloud, thing.foot.x, thing.foot.y, motion.elapsedMs, {
      rain,
      glow: thing.glow,
    });
    paintInto(buffer, clipToMask(scene.mask, image), margin, margin, REFLECTION_ALPHA);
  }

  for (const ripple of ripples.ripples) {
    if (ripple.active) {
      const ring = clipToMask(scene.mask, rippleCloud(ripple, scene.sky.ring, scene.sky.glint));
      paintInto(buffer, ring, margin, margin, rippleAlpha(ripple));
    }
  }

  if (motion.strike > 0) {
    for (const puddle of scene.puddles) {
      const lit: PixelCloud = puddle.water.map((pixel) => ({ x: pixel.x, y: pixel.y, ink: "foam" }));
      paintInto(buffer, lit, margin, margin, STRIKE_GAIN * Math.min(motion.strike, 1));
    }
  }
}
