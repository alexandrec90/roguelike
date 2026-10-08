/**
 * Everything the hero looks like this frame, from the simulation's state: the
 * lit body, the scarf's tail, the swing's crescent, the burning blade's flames
 * and embers, his shadow, and the light the blade throws.
 *
 * Renderer-free and deterministic, so it is testable and the lab could drive it;
 * `hero-layer.ts` only paints what this returns. It owns the few pieces of
 * presentation state that have memory — the particle pool, the scarf chain,
 * where the blade was last frame, how far round the drawn turn has swept — and
 * none of them can reach back into the
 * simulation: a flame never decides whether a blow landed.
 */

import { clearPool, createPool, particleCloud, stepParticles, type ParticlePool } from "../fx/particles";
import type { PixelCloud } from "../ink";
import type { LightSource } from "../lights";
import { BLADE_SPAN, CAST, HERO_EQUIPPED, WALK } from "../models";
import { solveModel, type SolvedPose } from "../rig";
import { walkClipMs, type PlayerState } from "../player";
import { TILE_DEPTH, TILE_WIDTH } from "../projection";
import { windAt, type WindOptions } from "../wind";
import {
  bladeLight,
  createFireEmitter,
  emitBladeFire,
  emitHitBurst,
  type BladeSegment,
  type FireEmitter,
} from "./blade-fire";
import { heroFigure, layeredPose } from "./hero-figure";
import { heroShadow, type ShadowLight } from "./hero-shadow";
import { boneSpan } from "./rig-volume";
import { createScarf, scarfPrims, settleScarf, stepScarf, type Scarf } from "./scarf";
import { trailCloud, trailSegments } from "./swing-trail";
import { easeYaw } from "./turn";

export interface LookInput {
  readonly player: PlayerState;
  readonly elapsedMs: number;
  readonly deltaMs: number;
  readonly sun: ShadowLight;
  readonly wind?: WindOptions;
}

export interface LookFrame {
  /** Just him — what a puddle reflects and a transform melts. */
  readonly figure: PixelCloud;
  /** Him and everything around him, in draw order, foot-relative. */
  readonly scene: PixelCloud;
  /** On the ground under him, foot-relative. */
  readonly shadow: PixelCloud;
  /** The blade's outer span this frame, foot-relative screen pixels. */
  readonly blade: BladeSegment | undefined;
}

/** How hard walking drags the scarf's tail, px/ms². */
const SCARF_DRAG = 0.0006;
const SCARF_WIND = 0.00014;
const SCARF_GROUP = 1000;
/** How far behind (or, turned away, in front of) the spine the tail hangs. */
const SCARF_DEPTH = 2.9;

/**
 * Which of his switchable effects are drawn; all of them when absent. Read
 * every frame, so a caller may hand getters over live switches.
 */
export interface LookShows {
  readonly scarf: boolean;
  readonly trail: boolean;
  /** Blade fire and hit sparks. */
  readonly particles: boolean;
  readonly shadow: boolean;
}

const ALL_SHOWN: LookShows = { scarf: true, trail: true, particles: true, shadow: true };

export class HeroLook {
  private readonly pool: ParticlePool;
  private readonly fire: FireEmitter;
  private readonly scarf: Scarf;
  private settled = false;
  /** Whether his particles were on last frame: the frame they go off, the pool is emptied. */
  private sparking = true;
  private lastBlade: BladeSegment | undefined;
  /** The rig's drawn yaw, chasing `player.facing`; unset until the first frame. */
  private yaw: number | undefined;

  constructor(
    seed = 0x4e50,
    private readonly shows: LookShows = ALL_SHOWN,
  ) {
    this.pool = createPool(180, seed);
    this.fire = createFireEmitter(seed + 1);
    this.scarf = createScarf(seed + 2);
  }

  /** Sparks (or flame) off the blade's tip — a blow landed. */
  hit(burning: boolean): void {
    const blade = this.lastBlade;
    if (blade !== undefined && this.shows.particles) {
      emitHitBurst(this.pool, blade.bx, blade.by, burning);
    }
  }

  /** The blade's light, if it is burning, in screen pixels. */
  light(player: PlayerState, footX: number, footY: number, elapsedMs: number): LightSource | undefined {
    const blade = this.lastBlade;
    return player.enchanted && blade !== undefined ? bladeLight(blade, footX, footY, elapsedMs) : undefined;
  }

  frame(input: LookInput): LookFrame {
    const { player } = input;
    const pose = layeredPose(tracksOf(player, input.elapsedMs));
    // Turned, not mirrored: the eyes slide round the head with the turn itself,
    // so there is no separate gaze to add. Swept rather than cut (`turn.ts`).
    this.yaw = easeYaw(this.yaw ?? player.facing, player.facing, input.deltaMs);
    const orient = { yaw: this.yaw };
    const scarf = this.shows.scarf;
    // Put away, the tail is hung afresh from his neck when it comes back, not where it was left.
    this.settled &&= scarf;
    const extras = scarf ? this.scarfExtras(pose, orient.yaw, input) : [];

    const figure = heroFigure(pose, {
      ...orient,
      enchanted: player.enchanted,
      timeMs: input.elapsedMs,
      light: { x: input.sun.light.x, y: input.sun.light.y, ambient: 0.24 },
      extras,
    });

    const blade = bladeOf(figure.solved);
    const particles = this.shows.particles;
    if (particles) {
      this.stepParticles(player, blade, input.deltaMs);
    } else {
      if (this.sparking) {
        clearPool(this.pool);
      }
      this.lastBlade = blade;
    }
    this.sparking = particles;
    const trail =
      player.attackMs === undefined || !this.shows.trail
        ? { behind: [], front: [] }
        : trailCloud(trailSegments(player.attackMs, layeredPose({ ...tracksOf(player, input.elapsedMs), swingMs: undefined }), orient), player.enchanted);
    const sparks = particles ? particleCloud(this.pool) : [];
    const scene = [...trail.behind, ...figure.cloud, ...trail.front, ...sparks];
    const shadow = this.shows.shadow ? heroShadow(figure.cloud, input.sun) : [];
    return { figure: figure.cloud, scene, shadow, blade };
  }

  /** The scarf, stepped from where his neck is now, as the figure's extra primitives. */
  private scarfExtras(pose: ReturnType<typeof layeredPose>, yaw: number, input: LookInput): ReturnType<typeof scarfPrims> {
    const skeleton = solveModel(HERO_EQUIPPED, pose, { yaw });
    this.stepScarf(skeleton, input);
    return scarfPrims(this.scarf, depthOf(skeleton, yaw), SCARF_GROUP);
  }

  private stepScarf(solved: SolvedPose, input: LookInput): void {
    const neck = boneSpan(solved, "torso", 0.88, 0.88)?.a;
    if (neck === undefined) {
      return;
    }
    const anchor = { x: neck.x, y: neck.y + 0.5 };
    if (!this.settled) {
      settleScarf(this.scarf, anchor);
      this.settled = true;
    }
    const { player } = input;
    const gait = player.motion === "walk" ? player.gait : undefined;
    const wind = windAt(input.elapsedMs, 0, 0, input.wind ?? {}) * SCARF_WIND;
    const drive = {
      x: -(gait?.strafe ?? 0) * SCARF_DRAG + wind,
      y: (gait?.forward ?? 0) * SCARF_DRAG,
    };
    stepScarf(this.scarf, anchor, input.deltaMs, drive);
  }

  /**
   * Age the flames, slide them with the world, and feed the blade's fire.
   *
   * The hero never moves on screen — the planet slides under him — so a flame
   * that has left the blade must slide with the planet or it would be carried
   * along beside him like a banner.
   */
  private stepParticles(player: PlayerState, blade: BladeSegment | undefined, deltaMs: number): void {
    const delta = Math.min(Math.max(deltaMs, 0), 50);
    const { stepped } = player;
    if (stepped.x !== 0 || stepped.y !== 0) {
      const dx = -stepped.x * TILE_WIDTH;
      const dy = stepped.y * TILE_DEPTH;
      for (const particle of this.pool.particles) {
        particle.x += dx;
        particle.y += dy;
      }
    }
    stepParticles(this.pool, delta);
    if (blade !== undefined && player.enchanted) {
      const last = this.lastBlade ?? blade;
      const scale = delta > 0 ? 1 / delta : 0;
      const velocity = {
        x: ((blade.ax + blade.bx - last.ax - last.bx) / 2) * scale,
        y: ((blade.ay + blade.by - last.ay - last.by) / 2) * scale,
      };
      emitBladeFire(this.pool, this.fire, blade, delta, velocity);
    }
    this.lastBlade = blade;
  }
}

/** Which clips are playing where, read off the simulation's clocks. */
export function tracksOf(player: PlayerState, elapsedMs: number): Parameters<typeof layeredPose>[0] {
  return {
    idleMs: elapsedMs,
    walkMs: player.motion === "walk" ? walkClipMs(player, WALK.durationMs) : undefined,
    castMs: player.castMs !== undefined && player.castMs < CAST.durationMs ? player.castMs : undefined,
    swingMs: player.attackMs,
  };
}

function bladeOf(solved: SolvedPose): BladeSegment | undefined {
  const span = boneSpan(solved, "sword", BLADE_SPAN.from, 0.97);
  return span === undefined ? undefined : { ax: span.a.x, ay: span.a.y, bx: span.b.x, by: span.b.y };
}

/** Behind his back, turned with him: behind the spine from the front, before it from behind. */
function depthOf(solved: SolvedPose, yaw: number): number {
  const neck = solved["torso"]?.end.y ?? 0;
  return neck - SCARF_DEPTH * Math.cos(yaw);
}
