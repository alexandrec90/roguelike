/**
 * The Phaser side of `ambient-life.ts`: a few dozen motes over the field.
 *
 * A `Graphics` rather than a surface, deliberately: this is at most ~45 pixels
 * a frame, and a full-screen canvas upload to show 45 pixels would cost more
 * than the fills. Drawn over the world and under the lighting pass, so a
 * firefly is dark but for its own light, which is exactly a firefly.
 */

import type Phaser from "phaser";

import { fireflies, moteCloud, moteLights, pollen } from "./ambient-life";
import { drawCloud } from "./draw-cloud";
import type { FrameContext } from "./frame-context";
import type { Odometer } from "./odometer";
import { windAt } from "./wind";

/** Over every standing thing, under the lighting pass and the weather. */
const AMBIENT_DEPTH = 3000;

export class AmbientLayer {
  private gfx!: Phaser.GameObjects.Graphics;

  create(scene: Phaser.Scene): void {
    this.gfx = scene.add.graphics().setDepth(AMBIENT_DEPTH);
  }

  update(ctx: FrameContext, odometer: Odometer): void {
    const night = 1 - ctx.atmosphere.daylight;
    const ground = { x: odometer.x, y: odometer.y };
    const flies = fireflies(ctx.elapsedMs, night * (1 - ctx.rain), ground);
    const wind = windAt(ctx.elapsedMs, 0, 0, ctx.wind);
    const specks = pollen(ctx.elapsedMs, ctx.atmosphere.daylight * (1 - ctx.rain), wind, ground);
    this.gfx.clear();
    drawCloud(this.gfx, moteCloud(specks), 0, 0, 0.85);
    drawCloud(this.gfx, moteCloud(flies), 0, 0);
    for (const light of moteLights(flies)) {
      ctx.lights.push(light);
    }
  }
}
