/**
 * The drawing side of `wildfire.ts`: scars on the ground, flames standing in the
 * grass, sparks going up, and the light a burning meadow throws.
 *
 * Placed exactly as the decals are (`fire/anchor.ts`): a planet cell's point
 * through the *zero-phase* grid plus `scrollOffset`, so a burning patch never
 * shears a pixel against the ground it is burning on.
 *
 * - **Scars** are one surface at ground level, re-painted only when the pose,
 *   the fire or a slow fade tick changes.
 * - **Flames** stand, so they sort with the hero and the trees: one small pooled
 *   surface per burning cell, at that cell's row.
 * - **Sparks** are one pooled particle system drawn over the world.
 */

import type { Scene } from "../engine";

import { groundRow, localFoot, scrollOffset, type CameraFrame } from "./camera";
import { groundFoot, onField } from "./fire/anchor";
import type { FrameContext } from "./frame-context";
import { createPool, emit, particleCloud, stepParticles, type ParticleSpec } from "./fx/particles";
import { INK_COLORS } from "./ink";
import { PixelSurface } from "./pixel-surface";
import { toLocal, type PlanetPoint, type PlanetPose } from "./planet";
import { RANK, TILE_DEPTH, TILE_WIDTH } from "./projection";
import { INK_RAMPS } from "./shading";
import { pixelHash } from "./transforms";
import { grassFlameCloud, scorchCloud } from "./wildfire-art";
import {
  burningCells,
  createWildfire,
  douse,
  flameAt,
  ignite,
  scorchedCells,
  stepWildfire,
  type FireCell,
  type Wildfire,
} from "./wildfire";
import { windAt } from "./wind";

/** Just over the ground and the decals, under the grass and everything standing. */
const SCAR_DEPTH = -940;
const SPARK_DEPTH = 2900;
const MARGIN = TILE_WIDTH;
const FLAME_POOL = 40;
const FLAME_W = 20;
const FLAME_H = 18;
/** At most this many burning cells light the scene; the rest ride on their glow. */
const MAX_LIGHTS = 16;

const SPARK: ParticleSpec = {
  ramp: INK_RAMPS.fire,
  levelFrom: 0.95,
  levelTo: 0.35,
  lifeMs: [500, 1100],
  speed: [0.01, 0.03],
  angle: [-Math.PI * 0.75, -Math.PI * 0.25],
  gravity: -0.00003,
  drag: 0.001,
  wobble: 0.012,
  fade: 0.5,
};

const SMOKE: ParticleSpec = {
  ramp: INK_RAMPS.smoke,
  levelFrom: 0.2,
  levelTo: 1,
  lifeMs: [900, 1700],
  speed: [0.008, 0.018],
  angle: [-Math.PI * 0.65, -Math.PI * 0.35],
  gravity: -0.00001,
  wobble: 0.01,
  size: 2,
  fade: 0.6,
};

export class WildfireLayer {
  readonly fire: Wildfire = createWildfire();
  private scars!: PixelSurface;
  private sparks!: PixelSurface;
  private readonly pool = createPool(160, 0xf12e);
  private flames: PixelSurface[] = [];
  private painted = "";

  create(scene: Scene, width: number, height: number): void {
    this.scars = new PixelSurface(scene, width + MARGIN * 2, height + MARGIN * 2, "scars");
    this.scars.image.setDepth(SCAR_DEPTH).setVisible(false);
    this.sparks = new PixelSurface(scene, width, height, "sparks");
    this.sparks.image.setDepth(SPARK_DEPTH).setVisible(false);
    this.flames = Array.from({ length: FLAME_POOL }, () => {
      const surface = new PixelSurface(scene, FLAME_W, FLAME_H, "grassfire");
      surface.image.setVisible(false);
      return surface;
    });
  }

  /** Set the grass alight within `radius` tiles of a planet point. */
  ignite(at: PlanetPoint, radius: number): void {
    ignite(this.fire, at, radius);
  }

  /** Put the fire out within `radius` tiles of a planet point. */
  douse(at: PlanetPoint, radius: number): void {
    douse(this.fire, at, radius);
  }

  update(ctx: FrameContext): void {
    const wind = windAt(ctx.elapsedMs, 0, 0, ctx.wind);
    stepWildfire(this.fire, ctx.deltaMs, ctx.rain, wind);
    stepParticles(this.pool, ctx.deltaMs);
    const burning = burningCells(this.fire);
    this.paintScars(ctx);
    this.drawFlames(ctx, burning);
    this.drawSparks(ctx, burning);
  }

  private paintScars(ctx: FrameContext): void {
    const cells = scorchedCells(this.fire);
    this.scars.image.setVisible(cells.length > 0);
    if (cells.length === 0) {
      return;
    }
    const offset = scrollOffset(ctx.frame);
    this.scars.image.setPosition(offset.x - MARGIN, offset.y - MARGIN);
    const signature = `${poseKey(ctx.pose)}|${this.fire.tick}|${Math.floor(ctx.elapsedMs / 250)}`;
    if (signature === this.painted) {
      return;
    }
    this.painted = signature;
    const flat: CameraFrame = { ...ctx.frame, phaseX: 0, phaseY: 0 };
    this.scars.clear();
    for (const cell of cells) {
      const foot = localFoot(flat, toLocal(ctx.pose, centre(cell)));
      if (foot.y < ctx.frame.groundTop) {
        continue;
      }
      const scorch = cell.litTick >= 0 ? 1 : Math.max(0, 1 - (this.fire.nowMs - cell.outMs) / 45_000);
      const heat = cell.litTick >= 0 ? 1 : Math.max(0, 1 - (this.fire.nowMs - cell.outMs) / 6000);
      const cloud = scorchCloud(cell.seed, scorch, heat, ctx.elapsedMs);
      this.scars.paint(cloud, foot.x + MARGIN - TILE_WIDTH / 2, foot.y + MARGIN - TILE_DEPTH);
    }
    this.scars.commit();
  }

  private drawFlames(ctx: FrameContext, burning: readonly FireCell[]): void {
    let used = 0;
    const lit: { x: number; y: number; strength: number }[] = [];
    for (const cell of burning) {
      if (used >= this.flames.length) {
        break;
      }
      const local = toLocal(ctx.pose, centre(cell));
      const foot = groundFoot(ctx.frame, local);
      if (!onField(ctx.frame, foot, ctx.width, ctx.height, MARGIN)) {
        continue;
      }
      const strength = flameAt(this.fire, cell);
      const surface = this.flames[used] as PixelSurface;
      used += 1;
      surface.clear().paint(grassFlameCloud(cell.seed, ctx.elapsedMs, strength), FLAME_W / 2, FLAME_H - 1).commit();
      surface.image
        .setPosition(foot.x - FLAME_W / 2, foot.y - FLAME_H + 1)
        .setDepth(groundRow(ctx.frame, local) * TILE_WIDTH + RANK.body - 1)
        .setVisible(true);
      lit.push({ x: foot.x, y: foot.y - 4, strength });
    }
    for (let index = used; index < this.flames.length; index += 1) {
      (this.flames[index] as PixelSurface).image.setVisible(false);
    }
    lit.sort((a, b) => b.strength - a.strength);
    for (const light of lit.slice(0, MAX_LIGHTS)) {
      ctx.lights.push({
        x: light.x,
        y: light.y,
        radius: 34,
        color: INK_COLORS["fire-5"],
        intensity: 0.75 * light.strength,
      });
    }
  }

  /** Sparks and smoke, in screen space over the burning cells. */
  private drawSparks(ctx: FrameContext, burning: readonly FireCell[]): void {
    for (const cell of burning) {
      const foot = groundFoot(ctx.frame, toLocal(ctx.pose, centre(cell)));
      if (!onField(ctx.frame, foot, ctx.width, ctx.height, MARGIN)) {
        continue;
      }
      const roll = pixelHash(cell.x, cell.y, cell.seed, Math.floor(ctx.elapsedMs / 90));
      if (roll < 0.35 * flameAt(this.fire, cell)) {
        emit(this.pool, roll < 0.12 ? SMOKE : SPARK, 1, foot.x, foot.y - 5, { inheritX: 0 });
      }
    }
    const cloud = particleCloud(this.pool);
    this.sparks.image.setVisible(cloud.length > 0);
    if (cloud.length > 0) {
      this.sparks.clear().paint(cloud, 0, 0).commit();
    }
  }
}

function centre(cell: FireCell): PlanetPoint {
  return { x: cell.x + 0.5, y: cell.y + 0.5 };
}

function poseKey(pose: PlanetPose): string {
  return `${pose.x.toFixed(3)},${pose.y.toFixed(3)},${pose.turn.toFixed(4)}`;
}
