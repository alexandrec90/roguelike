/**
 * The storm, as a layer of its own.
 *
 * Split out of `demo-scene.ts` for the reason the water was: the scene had
 * quietly become the overworld *and* the weather over it, and the two share
 * nothing but a clock. Every other part of the picture already goes through a
 * layer object — ground, vegetation, scenery, water, hero — and the rain was the
 * last one still inline.
 *
 * What is here is only the wiring. The rain is the pooled, seeded spark emitter
 * pointed downward, and the bolt and its flash are pure functions of elapsed
 * time (`weather.ts`), so a capture at a given `t` reproduces exactly. Nothing
 * in this file decides when it storms; it draws whatever the schedule says is
 * happening.
 *
 * The drops are handed to the water before they are drawn, so a drop that
 * reaches a puddle rings it on the same frame it lands rather than the next.
 */

// `Phaser` is an ambient *type* namespace, so annotations compile without this
// import — but `Phaser.BlendModes.ADD` below is a value read at runtime.
import Phaser from "phaser";

import type { CameraFrame } from "./camera";
import { hexToInt } from "./color";
import { INK_COLORS } from "./ink";
import { particleAlpha, stepEmitter, type EmitterState } from "./spark-emitter";
import { createRain, lightningAt, lightningBolt } from "./weather";
import type { WaterLayer } from "./water-layer";

/** Weather draws over the world: rain in front, then the bolt and its flash. */
const RAIN_DEPTH = 5000;
const BOLT_DEPTH = 6000;

export class WeatherLayer {
  private readonly seed: number;
  private rain!: EmitterState;
  private rainImages: Phaser.GameObjects.Image[] = [];
  private boltGfx!: Phaser.GameObjects.Graphics;
  private flash!: Phaser.GameObjects.Rectangle;
  private horizonY = 0;

  constructor(seed: number) {
    this.seed = seed;
  }

  create(scene: Phaser.Scene, width: number, height: number, horizonY: number): void {
    this.horizonY = horizonY;
    this.rain = createRain(width);
    // Bottom-right origin: the streak leans, and its bright head is its last
    // pixel, so that corner is where the drop actually is. An origin of 1 keeps
    // the offset a whole number of pixels, which a centred one would not on an
    // odd-sized texture.
    this.rainImages = this.rain.particles.map(() =>
      scene.add
        .image(-10, -10, "rain")
        .setOrigin(1, 1)
        .setVisible(false)
        .setDepth(RAIN_DEPTH)
        .setAlpha(0.7),
    );

    this.boltGfx = scene.add.graphics().setDepth(BOLT_DEPTH);
    this.flash = scene.add
      .rectangle(0, 0, width, height, 0xdff2ff, 1)
      .setOrigin(0, 0)
      .setDepth(BOLT_DEPTH + 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
  }

  animate(
    delta: number,
    elapsedMs: number,
    height: number,
    frame: CameraFrame,
    water: WaterLayer,
  ): void {
    this.stepRain(delta, height, frame, water);
    this.strike(elapsedMs, water);
  }

  /**
   * The same pooled emitter as the sparks, pointed down and leaned over by the
   * wind. Drops that reach water land in it rather than falling through.
   */
  private stepRain(
    delta: number,
    height: number,
    frame: CameraFrame,
    water: WaterLayer,
  ): void {
    stepEmitter(this.rain, delta);
    water.landRain(this.rain, delta, frame);

    this.rain.particles.forEach((particle, index) => {
      const image = this.rainImages[index];
      if (image === undefined) {
        return;
      }
      if (!particle.active || particle.y > height) {
        image.setVisible(false);
        return;
      }
      image
        .setPosition(Math.round(particle.x), Math.round(particle.y))
        .setAlpha(0.7 * particleAlpha(particle))
        .setVisible(true);
    });
  }

  /** Bolt and flash are pure functions of time, so a capture is repeatable. */
  private strike(elapsedMs: number, water: WaterLayer): void {
    const strike = lightningAt(elapsedMs, this.seed);
    this.boltGfx.clear();
    this.flash.setVisible(strike.active);
    water.setStrike(strike.active ? strike.alpha : 0);
    if (!strike.active) {
      return;
    }

    const width = this.flash.width;
    const x = 20 + Math.round(strike.xUnit * (width - 40));
    const points = lightningBolt(strike.boltSeed, x, 0, this.horizonY + 2);
    this.boltGfx.fillStyle(hexToInt(INK_COLORS.bone), Math.min(strike.alpha + 0.3, 1));
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (from === undefined || to === undefined) {
        continue;
      }
      const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1);
      for (let step = 0; step <= steps; step += 1) {
        const px = Math.round(from.x + ((to.x - from.x) * step) / steps);
        const py = Math.round(from.y + ((to.y - from.y) * step) / steps);
        this.boltGfx.fillRect(px, py, 1, 1);
      }
    }
    this.flash.setAlpha(0.1 * strike.alpha);
  }
}
