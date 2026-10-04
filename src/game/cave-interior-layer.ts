/**
 * The inside of a cave, on screen: the march's two pictures, either side of the hero.
 *
 * `cave-march.ts` draws the floor, the walls and the torches through the same
 * treadmill projection as everything outdoors; this layer only decides when
 * to re-draw (when the pose, the scroll or a flame moved) and shows the result
 * as two full-screen surfaces - `back` under the hero, `front` over him, so a
 * wall's face nearer than he is covers him.
 *
 * During a change of realm both follow the horizon's mask (`composeMasked`),
 * so the floor, the walls and the roof sweep in as one picture.
 */

import type { Scene } from "../engine";

import type { CaveMap } from "./cave-map";
import { caveLights, renderCave, type CavePicture, type CaveView } from "./cave-march";
import type { FrameContext } from "./frame-context";
import { composeMasked, transitionProgress, type HorizonTransition } from "./horizon-transition";
import { createBuffer, type PixelBuffer } from "./pixel-buffer";
import { PixelSurface } from "./pixel-surface";
import type { PlanetPose } from "./planet";
import { HORIZON_DEPTH } from "./projection";
import { CAVE } from "./realm";

/** Over the sky, the lip and the roof; under the hero and everything standing. */
export const CAVE_BACK_DEPTH = HORIZON_DEPTH + 8;

/** Over the hero; under the weather and the lighting pass. */
export const CAVE_FRONT_DEPTH = 3900;

/** Flames are re-drawn this often, ms. */
const FLAME_TICK_MS = 90;

export class CaveInteriorLayer {
  private back!: PixelSurface;
  private front!: PixelSurface;
  private picture!: CavePicture;
  private drawn = "";
  /** Whether the surfaces hold the picture unmasked, as last committed. */
  private whole = false;

  create(scene: Scene, width: number, height: number): void {
    this.back = new PixelSurface(scene, width, height, "cave-back");
    this.front = new PixelSurface(scene, width, height, "cave-front");
    this.back.image.setDepth(CAVE_BACK_DEPTH).setVisible(false);
    this.front.image.setDepth(CAVE_FRONT_DEPTH).setVisible(false);
    this.picture = {
      back: createBuffer(width, height),
      front: createBuffer(width, height),
      depth: new Float32Array(width * height),
    };
  }

  hide(): void {
    this.back.image.setVisible(false);
    this.front.image.setVisible(false);
    this.drawn = "";
  }

  /** One frame inside a cave, or changing to or from one; pushes its lights into `ctx.lights`. */
  update(ctx: FrameContext, map: CaveMap, entry: PlanetPose, transition: HorizonTransition | undefined): void {
    const view: CaveView = { frame: ctx.frame, pose: ctx.pose, entry, map, elapsedMs: ctx.elapsedMs };
    const signature = [
      map.seed,
      entry.turn,
      ctx.pose.x,
      ctx.pose.y,
      ctx.pose.turn,
      Math.round(ctx.frame.phaseX * 16),
      Math.round(ctx.frame.phaseY * 12),
      Math.floor(ctx.elapsedMs / FLAME_TICK_MS),
    ].join("|");
    const redrawn = signature !== this.drawn;
    if (redrawn) {
      renderCave(view, this.picture);
      this.drawn = signature;
    }
    if (transition !== undefined) {
      this.showMasked(ctx, transition);
    } else if (redrawn || !this.whole) {
      this.show(this.back, this.picture.back);
      this.show(this.front, this.picture.front);
      this.whole = true;
    }
    this.back.image.setVisible(true);
    this.front.image.setVisible(true);
    const share = transition === undefined ? 1 : shareOf(transition, ctx.elapsedMs);
    ctx.lights.push(...caveLights(view).map((light) => ({ ...light, intensity: light.intensity * share })));
  }

  private showMasked(ctx: FrameContext, transition: HorizonTransition): void {
    const inward = transition.to === CAVE;
    const progress = transitionProgress(transition, ctx.elapsedMs);
    for (const [surface, picture] of [
      [this.back, this.picture.back],
      [this.front, this.picture.front],
    ] as const) {
      composeMasked(surface.buffer, inward ? undefined : picture, inward ? picture : undefined, {
        style: transition.style,
        progress,
        originX: 0,
        originY: 0,
        screenWidth: ctx.width,
        screenHeight: ctx.height,
      });
      surface.touch().commit();
    }
    this.whole = false;
  }

  private show(surface: PixelSurface, picture: PixelBuffer): void {
    surface.buffer.data.set(picture.data);
    surface.touch().commit();
  }
}

/** How much of the cave shows, 0..1, during a change to or from it. */
function shareOf(transition: HorizonTransition, nowMs: number): number {
  const progress = transitionProgress(transition, nowMs);
  return transition.to === CAVE ? progress : 1 - progress;
}
