/**
 * Everything the scene does *because there is water on the field*, in one
 * place: the puddles in reach, their still bodies, and everything that moves
 * on them — the sky's glint, reflections, rain rings, a lightning flash.
 *
 * The shapes and the maths belong to `puddles.ts` and `water/`. What lives here
 * is only the Phaser side: two `PixelSurface`s and when each is repainted.
 *
 * - **The body** (`PUDDLE_DEPTH`) is baked, not drawn: re-painted only when the
 *   puddles are re-grown (once a step), when the sky they mirror has visibly
 *   moved on, or when the ground's wetness has swollen or shrunk them.
 * - **The surface** (`PUDDLE_DEPTH + 1`) is repainted every frame there is
 *   water on screen — a few hundred pixels, one texture upload.
 *
 * **Two coordinate systems meet here, and mixing them is the bug to watch for.**
 * Water is part of the ground, so every puddle, ripple and reflection is built
 * on the *zero-phase* grid and both surfaces are then slid by `scrollOffset` -
 * one `setPosition` each, and nothing can drift against the tile it is lying
 * on. But the hero and the rain are drawn in *screen* coordinates, because
 * neither of them scrolls: the hero is the anchor and the rain falls in front
 * of the world. So anything crossing from one to the other - where a drop went
 * in, where a reflected thing's feet are - has the offset taken off it on the
 * way, and that subtraction is the whole of the trick.
 */

import type Phaser from "phaser";

import { atmosphereAt, clockHours, type Atmosphere } from "./atmosphere";
import { localFoot, localReach, scrollOffset, visibleLocal, type CameraFrame } from "./camera";
import type { FrameContext } from "./frame-context";
import type { PixelCloud } from "./ink";
import { PixelSurface } from "./pixel-surface";
import { fromLocal, toLocal, type LocalPoint, type PlanetPose } from "./planet";
import type { ScreenPoint } from "./projection";
import { createPuddle, puddleHolds, rainImpact, type Puddle } from "./puddles";
import { createRippleField, spawnRipple, stepRipples, type RippleField } from "./ripples";
import { MAX_STEP_MS, type EmitterState } from "./spark-emitter";
import { puddlesNear } from "./terrain";
import { createMask, fillMask, maskAt, type WaterMask } from "./water/mask";
import { paintBodies, paintSurface, type WaterScene } from "./water/paint";
import type { Landing } from "./water/rain";
import { puddleScale } from "./water/schedule";
import type { Reflectable } from "./water/reflect";
import { reflectionKey, skyKey, skyReflection, type SkyReflection } from "./water/sky-inks";

export type { Reflectable } from "./water/reflect";

/**
 * Under everything that stands on the ground: water is *in* the ground, and a
 * puddle that painted over the hero's feet would read as a hole he is behind.
 */
export const PUDDLE_DEPTH = -900;

/** Slack round the render target, so a puddle is painted before it scrolls on. */
const MARGIN = 20;

/** A foot position on the ground - where a thing stands, so where it reflects. */
export interface Foot {
  readonly x: number;
  readonly y: number;
}

/**
 * Every puddle within `reach` tiles, grown on the zero-phase grid at `scale`.
 *
 * The one recipe for where a puddle is and what shape it has: the horizon lip
 * (`roll-water.ts`) grows its puddles here too, so the water it carries over
 * the seam is the same water, pixel for pixel. `keep` passes over a site by its
 * local position before its outline is traced - the lip's reach is a disc
 * hundreds of puddles wide, and it can see a cone of it. `around` moves the
 * swept disc's centre off the hero to a local point, so `reach` can be the
 * radius of what is wanted rather than its distance from him.
 */
export function growPuddles(
  frame: CameraFrame,
  pose: PlanetPose,
  reach: number,
  scale: number,
  options: { readonly keep?: (local: LocalPoint) => boolean; readonly around?: LocalPoint } = {},
): Puddle[] {
  const flat: CameraFrame = { ...frame, phaseX: 0, phaseY: 0 };
  const centre = options.around === undefined ? pose : fromLocal(pose, options.around);
  return puddlesNear(centre, reach).flatMap((site) => {
    const local = toLocal(pose, site);
    if (options.keep !== undefined && !options.keep(local)) {
      return [];
    }
    const foot = localFoot(flat, local);
    return createPuddle({
      id: `${Math.round(site.x)}:${Math.round(site.y)}`,
      centerX: foot.x,
      centerY: foot.y,
      radius: Math.max(2, site.size * scale),
      seed: site.seed,
    });
  });
}

/** What stands over the water this frame. */
export interface WaterActors {
  readonly hero?: Reflectable;
  readonly reflectables?: readonly Reflectable[];
}

/** How far round the hero the puddles are grown: every tile the target can show. */
function reachOf(ctx: FrameContext): number {
  const flat: CameraFrame = { ...ctx.frame, phaseX: 0, phaseY: 0 };
  return localReach(visibleLocal(flat, ctx.width, ctx.height));
}

export class WaterLayer {
  private puddles: Puddle[] = [];
  private ripples: RippleField = createRippleField();
  private mask!: WaterMask;
  private body!: PixelSurface;
  private surface!: PixelSurface;
  private sky: SkyReflection = skyReflection(atmosphereAt(13));
  private sampled: PlanetPose | undefined;
  /** The puddles grown ahead for the anchor the hero is walking into. */
  private ahead:
    | { readonly pose: PlanetPose; readonly scale: number; readonly reach: number; readonly puddles: Puddle[] }
    | undefined;
  private bakedKey = "";
  private atmosphereKey = "";
  private scale = 1;
  private rain = 0;
  private strike = 0;
  private surfaceDirty = false;

  /** The two surfaces. What is on them arrives with the first `update`. */
  create(scene: Phaser.Scene, width = 320, height = 180): void {
    this.mask = createMask(width, height, MARGIN);
    this.body = new PixelSurface(scene, this.mask.width, this.mask.height, "water-body");
    this.body.image.setDepth(PUDDLE_DEPTH);
    this.surface = new PixelSurface(scene, this.mask.width, this.mask.height, "water-surface");
    this.surface.image.setDepth(PUDDLE_DEPTH + 1);
  }

  /**
   * One frame of water: re-grow the puddles if the pose moved on, re-bake the
   * bodies if the sky or the wetness changed, then paint what moves.
   * `actors` are in screen pixels, feet where they are drawn.
   */
  update(ctx: FrameContext, actors: WaterActors = {}): void {
    this.relocate(ctx.frame, ctx.pose, reachOf(ctx));
    this.draw(ctx.frame, ctx.atmosphere, ctx.elapsedMs, ctx.deltaMs, actors);
  }

  /** `prefetch` for the anchor the hero is walking into, at the reach `update` sweeps. */
  prefetchFor(ctx: FrameContext, pose: PlanetPose): void {
    this.prefetch(ctx.frame, pose, reachOf(ctx));
  }

  /**
   * Re-grow the puddles in reach, on the zero-phase grid.
   *
   * Only when the pose the world is sampled from has actually moved on, which
   * is once per step rather than once per frame: a puddle outline is a seeded
   * walk round a rim, and it must not be re-rolled sixty times a second under a
   * hero who has not finished a stride.
   */
  relocate(frame: CameraFrame, pose: PlanetPose, reach: number): void {
    if (this.sampled === pose) {
      return;
    }
    this.sampled = pose;
    this.bakedKey = "";
    const ahead = this.ahead;
    this.puddles =
      ahead?.pose === pose && ahead.scale === this.scale && ahead.reach === reach
        ? ahead.puddles
        : growPuddles(frame, pose, reach, this.scale);
    this.ahead = undefined;
    fillMask(this.mask, this.puddles);
  }

  /** Grow the puddles for the anchor the hero is walking into, ahead of the frame that crosses into it. */
  prefetch(frame: CameraFrame, pose: PlanetPose, reach: number): void {
    if (this.sampled === pose || (this.ahead?.pose === pose && this.ahead.scale === this.scale)) {
      return;
    }
    this.ahead = { pose, scale: this.scale, reach, puddles: growPuddles(frame, pose, reach, this.scale) };
  }

  /** How much the wet weather has swollen every puddle: the radius multiplier. */
  sizeScale(): number {
    return this.scale;
  }

  /** How hard it is raining (roughens reflections) and how soaked the ground is (sizes puddles). */
  setWeather(rain: number, wetness: number): void {
    this.rain = rain;
    const scale = puddleScale(wetness);
    if (scale !== this.scale) {
      this.scale = scale;
      this.sampled = undefined;
    }
  }

  /** How hard the storm is lighting the water this instant; 0 is no strike. */
  setStrike(alpha: number): void {
    this.strike = alpha;
  }

  /**
   * A drop that reached the ground: if it came down into water, ring the
   * puddle and report it caught. The drop's last segment goes to `rainImpact`
   * — where along it the ring belongs is that function's problem, and the
   * comment there is the one worth reading. The scroll offset comes off both
   * ends because rain falls in screen space and puddles do not.
   */
  catchDrop(landing: Landing, frame: CameraFrame): boolean {
    if (this.puddles.length === 0) {
      return false;
    }
    const offset = scrollOffset(frame);
    const impact = rainImpact(
      this.puddles,
      landing.fromX - offset.x,
      landing.fromY - offset.y,
      landing.x - offset.x,
      landing.y - offset.y,
    );
    if (impact === null) {
      return false;
    }
    spawnRipple(this.ripples, impact.x, impact.y);
    return true;
  }

  /** Whichever puddle a screen-space foot is standing in, if any. */
  puddleUnder(point: Foot, offset: ScreenPoint): Puddle | undefined {
    return this.puddles.find((puddle) => puddleHolds(puddle, point.x - offset.x, point.y - offset.y));
  }

  /**
   * Is this screen pixel standing water right now? One array read — cheap
   * enough for a grass or decal layer to ask per tuft, so nothing grows in a
   * puddle or scorches its surface.
   */
  holdsWater(point: Foot, frame: CameraFrame): boolean {
    const offset = scrollOffset(frame);
    return maskAt(this.mask, point.x - offset.x, point.y - offset.y) !== 0;
  }

  /** The puddles in reach, zero-phase screen pixels. */
  puddlesInReach(): readonly Puddle[] {
    return this.puddles;
  }

  /**
   * The old per-emitter entry point, for a scene still driving the curtain
   * rain of `createRain`: every drop that crossed water this step rings it.
   */
  landRain(rain: EmitterState, delta: number, frame: CameraFrame): void {
    const step = Math.min(Math.max(delta, 0), MAX_STEP_MS);
    for (const particle of rain.particles) {
      if (!particle.active) {
        continue;
      }
      const landing = {
        sheet: 1 as const,
        fromX: particle.x - particle.vx * step,
        fromY: particle.y - particle.vy * step,
        x: particle.x,
        y: particle.y,
      };
      if (this.catchDrop(landing, frame)) {
        particle.active = false;
      }
    }
  }

  /**
   * The pre-`FrameContext` entry point, kept so a scene that has not moved to
   * `update(ctx, actors)` still draws water. It reads the default clock for
   * the sky; the torch is no longer reflected here — pass it (or the campfire)
   * as a `glow` reflectable through `update`.
   */
  animate(
    delta: number,
    elapsedMs: number,
    hero: { readonly cloud: PixelCloud; readonly foot: Foot },
    _torchFoot: Foot,
    frame: CameraFrame,
  ): void {
    this.draw(frame, atmosphereAt(clockHours(elapsedMs)), elapsedMs, delta, { hero });
  }

  private draw(
    frame: CameraFrame,
    atmosphere: Atmosphere,
    elapsedMs: number,
    deltaMs: number,
    actors: WaterActors,
  ): void {
    stepRipples(this.ripples, Math.min(Math.max(deltaMs, 0), 40));
    const offset = scrollOffset(frame);
    this.body.image.setPosition(offset.x - MARGIN, offset.y - MARGIN);
    this.surface.image.setPosition(offset.x - MARGIN, offset.y - MARGIN);

    const scene: WaterScene = { puddles: this.puddles, mask: this.mask, sky: this.sky };
    this.bake(atmosphere, scene);
    if (this.puddles.length === 0) {
      this.blankSurface();
      return;
    }

    const things = [...(actors.hero === undefined ? [] : [actors.hero]), ...(actors.reflectables ?? [])];
    const reflect = things.map((thing) => ({
      ...thing,
      foot: { x: thing.foot.x - offset.x, y: thing.foot.y - offset.y },
    }));
    this.surface.clear();
    paintSurface(this.surface.buffer, { ...scene, sky: this.sky }, this.ripples, reflect, {
      elapsedMs,
      rain: this.rain,
      strike: this.strike,
    });
    this.surface.commit();
    this.surfaceDirty = true;
  }

  /** Re-paint the still bodies when the puddles, their size or the sky they mirror changed. */
  private bake(atmosphere: Atmosphere, scene: WaterScene): void {
    const atmosphereKey = skyKey(atmosphere);
    if (atmosphereKey !== this.atmosphereKey) {
      this.atmosphereKey = atmosphereKey;
      this.sky = skyReflection(atmosphere);
    }
    const key = reflectionKey(this.sky);
    if (key === this.bakedKey) {
      return;
    }
    this.bakedKey = key;
    paintBodies(this.body.buffer, { ...scene, sky: this.sky });
    this.body.touch().commit();
  }

  private blankSurface(): void {
    if (this.surfaceDirty) {
      this.surface.clear().commit();
      this.surfaceDirty = false;
    }
  }
}
