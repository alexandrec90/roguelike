/**
 * The band above the field, when it shows somewhere other than the sky.
 *
 * One `PixelSurface` over the sky and the horizon lip, drawn only while a
 * `Backdrop` (`backdrop.ts`) is current or a change of horizon is in flight.
 * Under the sky (`OUTDOORS`) it is hidden and costs nothing: the sky and the
 * lip are their own layers and show through.
 *
 * During a change it paints both ends - either of which may be `OUTDOORS`,
 * which is transparent here so the live sky shows - and mixes them per pixel by
 * the transition's mask (`horizon-transition.ts`). A cave, a portal and a dive
 * are the same code with a different backdrop and style; this file knows none
 * of them by name.
 *
 * It also answers for what the place does to the light: the ambient the world
 * is multiplied by (`ambientFor`) and the backdrop's own lights, each eased
 * across a change by the transition's progress.
 */

import type { Scene } from "../engine";

import { OUTDOORS, type Backdrop, type BackdropView } from "./backdrop";
import { mixHex } from "./color";
import type { FrameContext } from "./frame-context";
import { composeMasked, transitionProgress, type HorizonTransition } from "./horizon-transition";
import type { LightSource } from "./lights";
import { bearingOffset } from "./panorama";
import { createBuffer, type PixelBuffer } from "./pixel-buffer";
import { PixelSurface } from "./pixel-surface";
import { HORIZON_DEPTH } from "./projection";

/** Over the sky and the lip, under anything standing on the roll. */
export const BACKDROP_DEPTH = HORIZON_DEPTH + 2;

/** Where the horizon is: one place, or a change from one to another. */
export interface HorizonState {
  readonly current: string;
  readonly transition: HorizonTransition | undefined;
}

export class BackdropLayer {
  private surface!: PixelSurface;
  private readonly backdrops = new Map<string, Backdrop>();
  /** Each end of a change, painted on its own before they are mixed. */
  private ends: { from: PixelBuffer; to: PixelBuffer } | undefined;
  private painted = "";

  constructor(backdrops: readonly Backdrop[]) {
    for (const backdrop of backdrops) {
      this.backdrops.set(backdrop.id, backdrop);
    }
  }

  create(scene: Scene, width: number, height: number): void {
    this.surface = new PixelSurface(scene, width, Math.max(1, height), "backdrop");
    this.surface.image.setDepth(BACKDROP_DEPTH).setVisible(false);
    this.ends = { from: createBuffer(width, Math.max(1, height)), to: createBuffer(width, Math.max(1, height)) };
  }

  /** The ambient the world is lit by here, given the hour's: a backdrop's own, eased across a change. */
  ambientFor(hours: string, state: HorizonState, nowMs: number): string {
    const of = (id: string): string => this.backdrops.get(id)?.ambient ?? hours;
    if (state.transition === undefined) {
      return of(state.current);
    }
    return mixHex(of(state.transition.from), of(state.transition.to), transitionProgress(state.transition, nowMs));
  }

  /** One frame: draw the band for `state`, and push the light it gives off into `ctx.lights`. */
  update(ctx: FrameContext, turn: number, state: HorizonState): void {
    const view: BackdropView = {
      width: this.surface.width,
      height: this.surface.height,
      offset: bearingOffset(turn),
      elapsedMs: ctx.elapsedMs,
    };
    if (state.transition === undefined) {
      this.showSteady(ctx, view, state.current);
    } else {
      this.showChange(ctx, view, state.transition);
    }
  }

  private showSteady(ctx: FrameContext, view: BackdropView, current: string): void {
    const backdrop = this.backdrops.get(current);
    if (current === OUTDOORS || backdrop === undefined) {
      this.surface.image.setVisible(false);
      this.painted = "";
      return;
    }
    const signature = `${backdrop.id}|${backdrop.signature(view)}`;
    if (signature !== this.painted) {
      this.painted = signature;
      backdrop.paint(this.surface.buffer, view);
      this.surface.touch().commit();
    }
    this.surface.image.setVisible(true);
    ctx.lights.push(...backdrop.lights(view));
  }

  private showChange(ctx: FrameContext, view: BackdropView, transition: HorizonTransition): void {
    const progress = transitionProgress(transition, ctx.elapsedMs);
    const from = this.paintEnd(transition.from, this.ends?.from, view);
    const to = this.paintEnd(transition.to, this.ends?.to, view);
    composeMasked(this.surface.buffer, from, to, {
      style: transition.style,
      progress,
      originX: 0,
      originY: 0,
      screenWidth: ctx.width,
      screenHeight: ctx.height,
    });
    this.surface.touch().commit();
    this.surface.image.setVisible(true);
    this.painted = "";
    ctx.lights.push(...this.lightsOf(transition.from, view, 1 - progress), ...this.lightsOf(transition.to, view, progress));
  }

  /** One end of a change painted into its buffer, or undefined for the sky, which other layers draw. */
  private paintEnd(id: string, buffer: PixelBuffer | undefined, view: BackdropView): PixelBuffer | undefined {
    const backdrop = this.backdrops.get(id);
    if (backdrop === undefined || buffer === undefined) {
      return undefined;
    }
    backdrop.paint(buffer, view);
    return buffer;
  }

  private lightsOf(id: string, view: BackdropView, share: number): LightSource[] {
    const backdrop = this.backdrops.get(id);
    if (backdrop === undefined || share <= 0) {
      return [];
    }
    return backdrop.lights(view).map((light) => ({ ...light, intensity: light.intensity * share }));
  }
}
