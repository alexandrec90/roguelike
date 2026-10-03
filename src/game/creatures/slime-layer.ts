/**
 * The slimes on screen: the drawing half of `slime-sim.ts`.
 *
 * Wiring only. The population, its decisions and its combat are the pure sim;
 * the pixels of each slime are `slimeFrame`; this file lends each live slime a
 * small `PixelSurface`, paints its shadow, goo and body into it once per frame
 * (one texture upload per slime, never a `fillRect` per pixel), and sorts it
 * into the world by its screen row like any other actor.
 *
 * It also turns the sim's events into what the player feels — a few frames of
 * hit stop and a jolt of shake on a hit, more on a kill — and returns the
 * events so the scene can add decals, sounds or score on top.
 */

import type { Scene } from "../../engine";

import { localPlacement, localRow } from "../camera";
import type { Strike } from "../combat";
import type { FrameContext } from "../frame-context";
import { createPool, clearPool, particleCloud, stepParticles, type ParticlePool } from "../fx/particles";
import type { PixelCloud } from "../ink";
import { flicker } from "../lights";
import type { LocalPoint } from "../planet";
import { PixelSurface } from "../pixel-surface";
import { RANK, TILE_DEPTH, TILE_WIDTH } from "../projection";
import type { Slime } from "./slime-brain";
import { emitDeathGoo, emitFlame, emitHitGoo, emitLanding, shiftPool } from "./slime-fx";
import { glowColor } from "./slime-palette";
import { slimeFrame } from "./slime-render";
import {
  createSlimeSim,
  MAX_SLIMES,
  nearestSlime,
  occupiedNear,
  stepSlimes,
  type SlimeEvents,
  type SlimeSim,
} from "./slime-sim";

/** Each slime's canvas, and where its foot sits inside it: room for a hop and a splash. */
const SURFACE_WIDTH = 48;
const SURFACE_HEIGHT = 48;
const FOOT_X = 24;
const FOOT_Y = 38;

/** How long a burning slime waits between flame licks, ms. */
const FLAME_EVERY_MS = 45;

export interface SlimeLayerInput {
  /** Every blow landing this frame, in its local frame (`combat.ts`). */
  readonly strikes: readonly Strike[];
  /** The hero's foot, local tiles — `(ctx.frame.phaseX, ctx.frame.phaseY)`. */
  readonly heroLocal: LocalPoint;
}

export interface SlimeLayerOptions {
  /** Kick hit stop and shake on hits and kills. On by default. */
  readonly impulses?: boolean;
}

/** A slime as the water sees it: its body cloud and the screen pixel of its foot. */
export interface SlimeReflectable {
  readonly cloud: PixelCloud;
  readonly x: number;
  readonly y: number;
}

interface Slot {
  readonly surface: PixelSurface;
  readonly pool: ParticlePool;
  /** The slime this slot is lent to, or 0 for none. */
  id: number;
  flameMs: number;
}

export class SlimeLayer {
  private readonly sim: SlimeSim = createSlimeSim();
  private readonly slots: Slot[] = [];
  private reflections: SlimeReflectable[] = [];
  private readonly impulses: boolean;

  constructor(options: SlimeLayerOptions = {}) {
    this.impulses = options.impulses ?? true;
  }

  create(scene: Scene): void {
    for (let index = 0; index < MAX_SLIMES; index += 1) {
      const surface = new PixelSurface(scene, SURFACE_WIDTH, SURFACE_HEIGHT, "slime");
      surface.image.setVisible(false);
      this.slots.push({ surface, pool: createPool(40, 0x5100 + index), id: 0, flameMs: 0 });
    }
  }

  /** Step the population, react to what happened, and draw every slime. */
  update(ctx: FrameContext, input: SlimeLayerInput): SlimeEvents {
    const events = stepSlimes(this.sim, {
      pose: ctx.pose,
      hero: input.heroLocal,
      strikes: input.strikes,
      deltaMs: ctx.deltaMs,
    });
    this.lend();
    this.react(ctx, events);
    this.reflections = [];
    for (const slime of this.sim.slimes) {
      const slot = this.slots.find((candidate) => candidate.id === slime.id);
      if (slot !== undefined) {
        this.draw(ctx, slime, slot, input.heroLocal);
      }
    }
    for (const slot of this.slots) {
      if (slot.id === 0) {
        slot.surface.image.setVisible(false);
      }
    }
    return events;
  }

  /** Whether a live slime stands within `radius` tiles of a local point. */
  occupiedNear(local: LocalPoint, radius: number): boolean {
    return occupiedNear(this.sim, local, radius);
  }

  /** The nearest live slime to a local point: its id, where it is, how far. */
  nearestSlime(local: LocalPoint): { readonly id: number; readonly at: LocalPoint; readonly distance: number } | null {
    const found = nearestSlime(this.sim, local);
    return found === null ? null : { id: found.slime.id, at: found.slime.local, distance: found.distance };
  }

  /** Every slime drawn this frame, for puddle reflections. */
  reflectables(): readonly SlimeReflectable[] {
    return this.reflections;
  }

  destroy(): void {
    for (const slot of this.slots) {
      slot.surface.destroy();
    }
    this.slots.length = 0;
  }

  /** Free the slots of slimes that are gone; lend free slots to slimes without one. */
  private lend(): void {
    const alive = new Set(this.sim.slimes.map((slime) => slime.id));
    for (const slot of this.slots) {
      if (slot.id !== 0 && !alive.has(slot.id)) {
        slot.id = 0;
        clearPool(slot.pool);
      }
    }
    for (const slime of this.sim.slimes) {
      if (this.slots.some((slot) => slot.id === slime.id)) {
        continue;
      }
      const free = this.slots.find((slot) => slot.id === 0);
      if (free !== undefined) {
        free.id = slime.id;
        free.flameMs = 0;
      }
    }
  }

  private slotOf(id: number): Slot | undefined {
    return this.slots.find((slot) => slot.id === id);
  }

  private react(ctx: FrameContext, events: SlimeEvents): void {
    for (const hit of events.hits) {
      const slot = this.slotOf(hit.id);
      if (slot !== undefined) {
        emitHitGoo(slot.pool, hit.variant, hit.push.x, -hit.push.y);
      }
      if (this.impulses && hit.damage > 0) {
        ctx.impulse.hitStop(hit.killed ? 70 : 45);
        ctx.impulse.shake(hit.killed ? 2.5 : 1.5, hit.killed ? 240 : 160);
      }
    }
    for (const death of events.deaths) {
      const slot = this.slotOf(death.id);
      if (slot !== undefined) {
        emitDeathGoo(slot.pool, death.variant);
      }
    }
    for (const landing of events.landings) {
      const slot = this.slotOf(landing.id);
      if (slot !== undefined) {
        emitLanding(slot.pool, landing.variant);
      }
    }
  }

  private draw(ctx: FrameContext, slime: Slime, slot: Slot, hero: LocalPoint): void {
    const image = slot.surface.image;
    const placed = localPlacement(ctx.frame, slime.local);
    const onScreen =
      placed.visible &&
      placed.x > -FOOT_X &&
      placed.x < ctx.width + FOOT_X &&
      placed.y > -8 &&
      placed.y < ctx.height + SURFACE_HEIGHT - FOOT_Y;
    this.stepEffects(ctx, slime, slot);
    if (!onScreen) {
      image.setVisible(false);
      return;
    }
    const light = ctx.atmosphere.light;
    const drawn = slimeFrame(slime, {
      light,
      elapsedMs: ctx.elapsedMs,
      hero,
      scale: placed.scale,
      shadowShift: -light.x * 2.5 * (1 - ctx.atmosphere.elevation),
    });
    const surface = slot.surface.clear();
    if (ctx.atmosphere.shadowStrength > 0.02) {
      surface.paint(drawn.shadow, FOOT_X, FOOT_Y, ctx.atmosphere.shadowStrength);
    }
    surface.paint(particleCloud(slot.pool), FOOT_X, FOOT_Y);
    surface.paint(drawn.body, FOOT_X, FOOT_Y);
    surface.commit();
    image
      .setPosition(placed.x - FOOT_X, placed.y - FOOT_Y)
      .setDepth(Math.round(localRow(ctx.frame, slime.local)) * TILE_WIDTH + RANK.actor)
      .setTint(ctx.shade.tint(placed.x, placed.y))
      .setVisible(true);
    this.reflections.push({ cloud: drawn.body, x: placed.x, y: placed.y });
    this.glow(ctx, slime, placed.x, placed.y - Math.round(slime.lift));
  }

  /** Particles: keep them on the ground the slime left, flames while it burns, then age them. */
  private stepEffects(ctx: FrameContext, slime: Slime, slot: Slot): void {
    const cos = Math.cos(ctx.pose.turn);
    const sin = Math.sin(ctx.pose.turn);
    const localX = slime.movedX * cos - slime.movedY * sin;
    const localY = slime.movedX * sin + slime.movedY * cos;
    shiftPool(slot.pool, localX * TILE_WIDTH, -localY * TILE_DEPTH);
    if (slime.burnMs > 0 && slime.mode !== "dying") {
      slot.flameMs -= ctx.deltaMs;
      if (slot.flameMs <= 0) {
        slot.flameMs = FLAME_EVERY_MS;
        emitFlame(slot.pool, 10);
      }
    }
    stepParticles(slot.pool, ctx.deltaMs);
  }

  /** Fire and arcane slimes light the grass around them; a burning slime does too. */
  private glow(ctx: FrameContext, slime: Slime, x: number, y: number): void {
    if (slime.mode === "dying" && slime.modeMs > 300) {
      return;
    }
    const burning = slime.burnMs > 0 ? glowColor("fire") : null;
    const color = burning ?? glowColor(slime.variant);
    if (color === null) {
      return;
    }
    ctx.lights.push({
      x,
      y: y - 5,
      radius: burning === null ? 26 : 34,
      color,
      intensity: (slime.variant === "arcane" && burning === null ? 0.35 : 0.55) * flicker(ctx.elapsedMs, slime.seed),
    });
  }
}
