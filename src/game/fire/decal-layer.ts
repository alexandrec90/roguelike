/**
 * Decals in the scene: every mark on the ground, on one surface.
 *
 * Lying things follow the water layer's pattern exactly: each mark is laid out
 * on the *zero-phase* grid and the whole surface is slid by `scrollOffset`, one
 * `setPosition` a frame, so a scorch cannot drift against the grass it burned.
 * The surface overhangs the target by a tile on every side, because the slide
 * is up to a tile and the row that scrolls on must already be painted.
 *
 * It repaints only when something that shows has changed — the pose the grid is
 * sampled from (once a step), the set of marks, or the fade clock, which ticks
 * at a tenth of a second because a fade that erodes ten times a second is
 * indistinguishable from one that erodes sixty. With no marks, it is hidden and
 * costs nothing.
 */

import type { Scene } from "../../engine";

import { localFoot, scrollOffset, type CameraFrame } from "../camera";
import { ALL_EFFECTS, type EffectSwitches } from "../effects";
import type { FrameContext } from "../frame-context";
import { PixelSurface } from "../pixel-surface";
import { toLocal, type PlanetPoint, type PlanetPose } from "../planet";
import { TILE_WIDTH } from "../projection";
import {
  createDecal,
  createDecalField,
  decalCloud,
  pruneDecals,
  stampDecal,
  type DecalField,
  type DecalKind,
} from "./decals";

/** Over the ground (-1000), under the puddles (-900). */
export const DECAL_DEPTH = -950;

/** How often a fading mark is re-eroded, ms. */
const FADE_TICK_MS = 100;

const MARGIN = TILE_WIDTH;

export class DecalLayer {
  readonly field: DecalField = createDecalField();
  private surface!: PixelSurface;
  private nowMs = 0;
  private paintedPose: PlanetPose | undefined;
  private paintedVersion = -1;
  private paintedTick = -1;

  /**
   * `decals` is read every frame: off, nothing is stamped and nothing painted,
   * and the marks already down are put away.
   */
  constructor(private readonly effects: EffectSwitches = ALL_EFFECTS) {}

  create(scene: Scene, width: number, height: number): void {
    this.surface = new PixelSurface(scene, width + MARGIN * 2, height + MARGIN * 2, "decals");
    this.surface.image.setDepth(DECAL_DEPTH).setVisible(false);
  }

  /** Lay a mark on the planet now. `seed` decides its shape. */
  stamp(at: PlanetPoint, kind: DecalKind, seed: number, radius?: number): void {
    if (this.effects.on("decals")) {
      stampDecal(this.field, createDecal(at, kind, seed, this.nowMs, radius));
    }
  }

  update(ctx: FrameContext): void {
    this.nowMs = ctx.elapsedMs;
    if (!this.effects.on("decals")) {
      if (this.field.decals.length > 0) {
        this.field.decals.length = 0;
        this.field.version += 1;
      }
      this.surface.image.setVisible(false);
      return;
    }
    pruneDecals(this.field, ctx.elapsedMs);
    const any = this.field.decals.length > 0;
    this.surface.image.setVisible(any);
    if (!any) {
      return;
    }
    const offset = scrollOffset(ctx.frame);
    this.surface.image.setPosition(offset.x - MARGIN, offset.y - MARGIN);

    const tick = Math.floor(ctx.elapsedMs / FADE_TICK_MS);
    if (ctx.pose === this.paintedPose && this.field.version === this.paintedVersion && tick === this.paintedTick) {
      return;
    }
    this.paintedPose = ctx.pose;
    this.paintedVersion = this.field.version;
    this.paintedTick = tick;
    this.repaint(ctx.frame, ctx.pose, ctx.elapsedMs);
  }

  private repaint(frame: CameraFrame, pose: PlanetPose, nowMs: number): void {
    const flat: CameraFrame = { ...frame, phaseX: 0, phaseY: 0 };
    // Rows above this are the horizon roll: the ground there is drawn curving
    // away, and a flat mark laid over it would sit in the sky.
    const top = frame.groundTop + MARGIN;
    this.surface.clear();
    for (const decal of this.field.decals) {
      const foot = localFoot(flat, toLocal(pose, decal.at));
      const x = foot.x + MARGIN;
      const y = foot.y + MARGIN;
      if (x < -32 || y < top - 16 || x > this.surface.width + 32 || y > this.surface.height + 32) {
        continue;
      }
      const cloud = decalCloud(decal, nowMs).filter((pixel) => pixel.y + y >= top);
      this.surface.paint(cloud, x, y);
    }
    this.surface.commit();
  }

  destroy(): void {
    this.surface.destroy();
  }
}

export type { DecalKind };
