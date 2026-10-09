/**
 * The campfire in the scene: `campfire.ts`'s simulation, on two surfaces.
 *
 * - **The body** — stones, logs, flame, embers, smoke — is one `PixelSurface`
 *   standing at the fire's foot and depth-sorted by screen row like a tree, so
 *   the hero walks in front of it and behind it.
 * - **The ground** — the ash bed and the warm pool — is a second surface just
 *   above the ground layer, so it lies under the hero's feet when he stands one
 *   row behind the fire instead of being painted over his boots.
 *
 * Both are placed from the *zero-phase* grid plus `scrollOffset`, the same way
 * the ground tiles and the water are, so the fire cannot shear a pixel against
 * the tile it is standing on mid-step. One upload each per frame, and the
 * stones and logs are copied from clouds built once rather than re-evaluated.
 */

import type { Scene } from "../../engine";

import { groundRow } from "../camera";
import { ALL_EFFECTS, type EffectSwitches } from "../effects";
import type { FrameContext } from "../frame-context";
import { clearPool } from "../fx/particles";
import type { PixelCloud } from "../ink";
import { PixelSurface } from "../pixel-surface";
import { toLocal, type PlanetPoint } from "../planet";
import { RANK, TILE_WIDTH, type ScreenPoint } from "../projection";
import { windAt } from "../wind";
import { groundFoot, onField } from "./anchor";
import {
  campfireCloud,
  campfireFlame,
  campfireGround,
  campfireLight,
  createCampfire,
  stepCampfire,
  type CampfireState,
} from "./campfire";

/** The body surface, and where the fire's foot sits inside it. */
const BODY_WIDTH = 64;
const BODY_HEIGHT = 90;
const BODY_FOOT_X = 32;
const BODY_FOOT_Y = 78;

const GROUND_WIDTH = 48;
const GROUND_HEIGHT = 28;
const GROUND_FOOT_X = 24;
const GROUND_FOOT_Y = 14;

/** Over the ground (-1000), under the puddles (-900) and the decals' embers. */
export const CAMPFIRE_GROUND_DEPTH = -945;

export class CampfireLayer {
  private state!: CampfireState;
  private at: PlanetPoint = { x: 0, y: 0 };
  private body!: PixelSurface;
  private ground!: PixelSurface;
  private footNow: ScreenPoint = { x: -99, y: -99 };
  private shown = false;

  /** Whether the embers and smoke were on last frame. */
  private sparking = true;

  /**
   * `particles` is read every frame: off, no ember or puff of smoke is emitted
   * or stepped, and those in the air when it went off are dropped.
   */
  constructor(private readonly effects: EffectSwitches = ALL_EFFECTS) {}

  create(scene: Scene, at: PlanetPoint, seed: number): void {
    this.at = at;
    this.state = createCampfire(seed);
    this.body = new PixelSurface(scene, BODY_WIDTH, BODY_HEIGHT, "campfire");
    this.ground = new PixelSurface(scene, GROUND_WIDTH, GROUND_HEIGHT, "campfire-ground");
    this.ground.image.setDepth(CAMPFIRE_GROUND_DEPTH);
  }

  update(ctx: FrameContext): void {
    const wind = windAt(ctx.elapsedMs, this.footNow.x, this.footNow.y, ctx.wind);
    const particles = this.effects.on("particles");
    if (!particles && this.sparking) {
      clearPool(this.state.embers);
      clearPool(this.state.smoke);
    }
    this.sparking = particles;
    stepCampfire(this.state, ctx.deltaMs, { wind, rain: ctx.rain, particles });

    const local = toLocal(ctx.pose, this.at);
    this.footNow = groundFoot(ctx.frame, local);
    // On the flat field only: the roll is a place, but a campfire over the
    // horizon is a speck nobody reads, and a surface there would float in the sky.
    this.shown = onField(ctx.frame, this.footNow, ctx.width, ctx.height, BODY_WIDTH);
    this.body.image.setVisible(this.shown);
    this.ground.image.setVisible(this.shown);
    if (!this.shown) {
      return;
    }

    this.body.clear().paint(campfireCloud(this.state, ctx.elapsedMs), BODY_FOOT_X, BODY_FOOT_Y).commit();
    this.body.image
      .setPosition(this.footNow.x - BODY_FOOT_X, this.footNow.y - BODY_FOOT_Y)
      .setDepth(groundRow(ctx.frame, local) * TILE_WIDTH + RANK.body);
    this.ground.clear().paint(campfireGround(this.state, ctx.elapsedMs), GROUND_FOOT_X, GROUND_FOOT_Y).commit();
    this.ground.image.setPosition(this.footNow.x - GROUND_FOOT_X, this.footNow.y - GROUND_FOOT_Y);
    ctx.lights.push(campfireLight(this.state, ctx.elapsedMs, this.footNow.x, this.footNow.y));
  }

  /** Where the fire's foot is on screen this frame — what a puddle reflects it at. */
  get foot(): ScreenPoint {
    return this.footNow;
  }

  /** Whether the fire was drawn this frame. */
  get visible(): boolean {
    return this.shown;
  }

  /** The flame this instant, foot-anchored on the pit: a reflection's source. */
  flameCloud(): PixelCloud {
    return campfireFlame(this.state);
  }

  destroy(): void {
    this.body.destroy();
    this.ground.destroy();
  }
}
