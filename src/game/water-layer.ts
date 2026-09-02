/**
 * Everything the scene does *because there is water on the field*, in one
 * place.
 *
 * This used to be six methods and seven fields on `DemoScene`, which made that
 * class two jobs wearing one name: the overworld, and the pond in it. The seam
 * is clean — nothing here reads the hero, the slime, the sky or the storm
 * except through arguments — so it is a layer the scene owns rather than a
 * concern spread through it. `structure_check` is what noticed; the split is
 * worth having on its own merits.
 *
 * The shapes and the maths all belong to `puddles.ts`. What lives here is only
 * the Phaser side of it: which `Graphics` object each layer lands on, in what
 * order, and at what alpha.
 */

// `Phaser` is an ambient *type* namespace, so the annotations below compile
// without it — but `Phaser.BlendModes.ADD` is a value read at runtime, and
// without this import the scene dies on the first frame with `Phaser is not
// defined`. `tsc` cannot see it; the browser can.
import Phaser from "phaser";

import { drawCloud } from "./draw-cloud";
import { cellFoot, PUDDLE_SITES } from "./field";
import type { PixelCloud } from "./ink";
import { quantizedWave } from "./pixel-art";
import {
  clipToPuddle,
  createPuddle,
  puddleGlints,
  puddleHolds,
  puddleReflection,
  puddleSurface,
  rainImpact,
  type Puddle,
} from "./puddles";
import {
  createRippleField,
  rippleAlpha,
  rippleCloud,
  spawnRipple,
  stepRipples,
  type RippleField,
} from "./ripples";
import { MAX_STEP_MS, type EmitterState } from "./spark-emitter";

/**
 * Under everything that stands on the ground: water is *in* the ground, and a
 * puddle that painted over the hero's feet would read as a hole he is behind.
 */
const PUDDLE_DEPTH = -900;

/** How hard the sky's shimmer is lit, on top of the ink's own opacity. */
const GLINT_ALPHA = 0.5;

/** A reflection is dimmer than the thing it reflects, always. */
const REFLECTION_ALPHA = 0.5;
const TORCH_REFLECTION_ALPHA = 0.55;

/** How far a torch's light smears down the water below it. */
const TORCH_REFLECTION_ROWS = 14;

/** Lightning lights water harder than it lights grass. */
const LIGHTNING_WATER_GAIN = 0.55;

/** A foot position on the ground — where a thing stands, so where it reflects. */
export interface Foot {
  readonly x: number;
  readonly y: number;
}

export class WaterLayer {
  private puddles: Puddle[] = [];
  private ripples!: RippleField;

  private bodyGfx!: Phaser.GameObjects.Graphics;
  private glintGfx!: Phaser.GameObjects.Graphics;
  private reflectionGfx!: Phaser.GameObjects.Graphics;
  private rippleGfx!: Phaser.GameObjects.Graphics;
  private flashGfx!: Phaser.GameObjects.Graphics;

  /**
   * One generated puddle per site, and the five layers drawn over them.
   *
   * The bodies never change, so they are stamped once here; only the glints,
   * the reflections and the rings are redrawn per frame.
   */
  create(scene: Phaser.Scene, groundTop: number): void {
    this.puddles = PUDDLE_SITES.map((site) => {
      const foot = cellFoot(site.column, site.row, groundTop);
      return createPuddle({
        id: site.id,
        centerX: foot.x + (site.offsetX ?? 0),
        centerY: foot.y + (site.offsetY ?? 0),
        radius: site.radius,
        seed: site.seed,
      });
    });

    this.bodyGfx = scene.add.graphics().setDepth(PUDDLE_DEPTH);
    for (const puddle of this.puddles) {
      drawCloud(this.bodyGfx, puddleSurface(puddle), 0, 0);
    }

    this.glintGfx = scene.add.graphics().setDepth(PUDDLE_DEPTH + 1);
    this.reflectionGfx = scene.add.graphics().setDepth(PUDDLE_DEPTH + 2);
    this.rippleGfx = scene.add.graphics().setDepth(PUDDLE_DEPTH + 3);

    // Stamped once at full strength and then held at alpha 0; a strike only
    // turns it up, so a flash costs one property set rather than a redraw.
    this.flashGfx = scene.add
      .graphics()
      .setDepth(PUDDLE_DEPTH + 4)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0);
    for (const puddle of this.puddles) {
      const lit: PixelCloud = puddle.water.map((pixel) => ({ ...pixel, ink: "deep" }));
      drawCloud(this.flashGfx, lit, 0, 0);
    }

    this.ripples = createRippleField();
  }

  puddleFor(id: string): Puddle | undefined {
    return this.puddles.find((puddle) => puddle.id === id);
  }

  /**
   * Retire every drop that crossed water this step, and ring the puddle where
   * it went in.
   *
   * The drop's own velocity reconstructs where it was before the step; where
   * along that segment the ring belongs is `rainImpact`'s problem, and the
   * comment there is the one worth reading.
   */
  landRain(rain: EmitterState, delta: number): void {
    const step = Math.min(Math.max(delta, 0), MAX_STEP_MS);
    for (const particle of rain.particles) {
      if (!particle.active) {
        continue;
      }
      const impact = rainImpact(
        this.puddles,
        particle.x - particle.vx * step,
        particle.y - particle.vy * step,
        particle.x,
        particle.y,
      );
      if (impact !== null) {
        spawnRipple(this.ripples, impact.x, impact.y);
        particle.active = false;
      }
    }
  }

  /**
   * Everything drawn on water, in the order light reaches the eye: the sky's
   * shimmer, then what is standing over it, then the rings the rain punched.
   *
   * The puddle sees whatever the hero is doing, transforms included, and gives
   * it back in the hero's own inks — a frozen hero reflects ice.
   */
  animate(
    delta: number,
    elapsedMs: number,
    hero: { readonly cloud: PixelCloud; readonly foot: Foot },
    torchFoot: Foot,
  ): void {
    stepRipples(this.ripples, Math.min(delta, 40));

    this.glintGfx.clear();
    for (const puddle of this.puddles) {
      drawCloud(this.glintGfx, puddleGlints(puddle, elapsedMs), 0, 0, GLINT_ALPHA);
    }

    this.reflectionGfx.clear();
    const heroPuddle = this.puddleFor("hero");
    if (heroPuddle !== undefined) {
      const reflection = puddleReflection(
        heroPuddle,
        hero.cloud,
        hero.foot.x,
        hero.foot.y,
        elapsedMs,
      );
      drawCloud(this.reflectionGfx, reflection, 0, 0, REFLECTION_ALPHA);
    }
    const torchPuddle = this.puddleFor("torch");
    if (torchPuddle !== undefined) {
      const light = this.torchReflection(torchPuddle, torchFoot, elapsedMs);
      drawCloud(this.reflectionGfx, light, 0, 0, TORCH_REFLECTION_ALPHA);
    }

    this.rippleGfx.clear();
    for (const ripple of this.ripples.ripples) {
      if (!ripple.active) {
        continue;
      }
      drawCloud(this.rippleGfx, this.overWater(rippleCloud(ripple)), 0, 0, rippleAlpha(ripple));
    }
  }

  /** How hard the storm is lighting the water this instant; 0 is no strike. */
  setStrike(alpha: number): void {
    this.flashGfx.setAlpha(LIGHTNING_WATER_GAIN * alpha);
  }

  /** Rings spread past the rim they started inside; the water is the frame. */
  private overWater(cloud: PixelCloud): PixelCloud {
    return cloud.filter((pixel) =>
      this.puddles.some((puddle) => puddleHolds(puddle, pixel.x, pixel.y)),
    );
  }

  /**
   * The torch on the water — a swaying column of light, not a mirrored sprite.
   *
   * A flame has no silhouette worth flipping; what a puddle actually shows of
   * one is a smeared streak that breaks up with distance, which is three lines
   * of wave rather than a second set of torch frames.
   */
  private torchReflection(puddle: Puddle, foot: Foot, elapsedMs: number): PixelCloud {
    const cloud: PixelCloud = [];
    for (let dy = 0; dy < TORCH_REFLECTION_ROWS; dy += 1) {
      const sway = quantizedWave(elapsedMs + dy * 130, 1100, 2, dy * 0.4);
      const half = dy < 5 ? 1 : 0;
      for (let dx = -half; dx <= half; dx += 1) {
        cloud.push({ x: foot.x + dx + sway, y: foot.y + dy, ink: dx === 0 ? "amber" : "ember" });
      }
    }
    return clipToPuddle(puddle, cloud);
  }
}
