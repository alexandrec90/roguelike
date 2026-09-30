/**
 * Spells in the scene: fireballs and frost novas — flight, burst, the blow they
 * deal, and the mark they leave.
 *
 * The lead's scene calls `launch` (a fireball) or `castNova` when the hero
 * casts, and `drainStrikes` once a frame to hand the blows to whatever can be
 * hit. Everything between is here: each fireball flies on the planet
 * (`fireball.ts`), bursts into an explosion (`explosion.ts`) where it hits
 * rock, a target or the end of its range, kicks the camera, stamps a scorch
 * through the `DecalLayer`, and pushes its lights. A nova (`frost-nova.ts`)
 * goes off where it is cast, strikes at once, and stamps a frost crack.
 *
 * Each live effect paints into its own `PixelSurface`, borrowed from a small
 * pool and returned when the effect burns out, so one effect is one upload and
 * one quad, and each one can take its own depth: a blast sorts by the screen
 * row it went off on and a fireball by the row it is over, so the hero passes
 * in front of one and behind the other correctly.
 */

import Phaser from "phaser";

import { localRow } from "../camera";
import type { Strike } from "../combat";
import type { FrameContext } from "../frame-context";
import { particleCloud } from "../fx/particles";
import { PixelSurface } from "../pixel-surface";
import { fromLocal, toLocal, type LocalPoint, type PlanetPoint, type PlanetPose } from "../planet";
import { RANK, TILE_DEPTH, TILE_WIDTH } from "../projection";
import { terrainAt } from "../terrain";
import { pixelHash } from "../transforms";
import { windAt } from "../wind";
import { groundFoot, onField } from "./anchor";
import type { DecalLayer } from "./decal-layer";
import { createExplosion, explosionCloud, explosionDone, explosionLight, stepExplosion, type Explosion } from "./explosion";
import {
  FIREBALL_HEIGHT,
  FIREBALL_RANGE,
  fireballCloud,
  fireballLight,
  fireballOffset,
  fireballPoint,
  fireballSpent,
  flyFireball,
  launchFireball,
  type Fireball,
} from "./fireball";
import { createFrostNova, frostNovaDone, frostNovaLight, novaRingCloud, stepFrostNova, type FrostNova } from "./frost-nova";

/** Big enough for a full-range flight in any direction, plus its trail and smoke. */
const SURFACE_WIDTH = 176;
const SURFACE_HEIGHT = 160;
/** The most effects alive at once; a new one past this retires the oldest. */
const EFFECT_CAP = 4;

/** The blast's blow: tiles of reach, damage, and knockback in tiles per second. */
export const BLAST_RADIUS = 1.4;
export const BLAST_DAMAGE = 2;
export const BLAST_FORCE = 6;
/** The nova's: wider, weaker, and it shoves harder — it is a defensive spell. */
export const NOVA_REACH = 1.9;
export const NOVA_DAMAGE = 1;
export const NOVA_FORCE = 8;

type HitTest = (local: LocalPoint) => boolean;

interface Flight {
  readonly kind: "flight";
  readonly ball: Fireball;
  readonly surface: PixelSurface;
  /** Where the launch point sits inside the surface. */
  readonly originX: number;
  readonly originY: number;
}

interface Blast {
  readonly kind: "blast";
  readonly explosion: Explosion;
  readonly at: PlanetPoint;
  readonly surface: PixelSurface;
}

interface Nova {
  readonly kind: "nova";
  readonly nova: FrostNova;
  readonly at: PlanetPoint;
  readonly surface: PixelSurface;
}

type Effect = Flight | Blast | Nova;

const BLAST_FOOT_X = SURFACE_WIDTH / 2;
const BLAST_FOOT_Y = SURFACE_HEIGHT - 40;

export class SpellLayer {
  private scene!: Phaser.Scene;
  private decals: DecalLayer | null = null;
  private hitTest: HitTest = () => false;
  private readonly effects: Effect[] = [];
  private readonly idle: PixelSurface[] = [];
  private strikes: Strike[] = [];
  private launches = 0;

  create(scene: Phaser.Scene, decals: DecalLayer | null, hitTest?: HitTest): void {
    this.scene = scene;
    this.decals = decals;
    if (hitTest !== undefined) {
      this.hitTest = hitTest;
    }
  }

  /** Swap the collision query — e.g. once the enemy layer exists. */
  setHitTest(hitTest: HitTest): void {
    this.hitTest = hitTest;
  }

  /**
   * Throw a fireball from `from` (local tiles, the pose's frame) along
   * `direction` (a local vector; normalised here).
   */
  launch(from: LocalPoint, direction: LocalPoint, pose: PlanetPose, elapsedMs: number): void {
    if (Math.hypot(direction.x, direction.y) === 0) {
      return;
    }
    this.launches += 1;
    const seed = Math.floor(pixelHash(Math.floor(elapsedMs), this.launches, 0xf1ba11) * 0xffffff);
    const ball = launchFireball(fromLocal(pose, from), direction, pose, seed);
    // Place the launch point inside the surface so the whole flight fits.
    const reachX = ball.direction.x * FIREBALL_RANGE * TILE_WIDTH;
    const reachY = -ball.direction.y * FIREBALL_RANGE * TILE_DEPTH;
    this.add({
      kind: "flight",
      ball,
      surface: this.borrow(),
      originX: Math.round(24 - Math.min(0, reachX)),
      originY: Math.round(44 + FIREBALL_HEIGHT - Math.min(0, reachY)),
    });
  }

  /**
   * Set off a frost nova at `at` (local tiles, the pose's frame): it strikes
   * this frame, rings out over 180 ms, and leaves a crack for three seconds.
   */
  castNova(at: LocalPoint, pose: PlanetPose, elapsedMs: number): void {
    this.launches += 1;
    const seed = Math.floor(pixelHash(Math.floor(elapsedMs), this.launches, 0x2f05) * 0xffffff);
    const point = fromLocal(pose, at);
    this.add({ kind: "nova", nova: createFrostNova(seed), at: point, surface: this.borrow() });
    this.strikes.push({ at, radius: NOVA_REACH, damage: NOVA_DAMAGE, element: "frost", force: NOVA_FORCE });
    this.decals?.stamp(point, "frost", seed + 2);
  }

  /** Every blow dealt since the last call, in the local frame it was dealt in. */
  drainStrikes(): Strike[] {
    const drained = this.strikes;
    this.strikes = [];
    return drained;
  }

  /** Effects alive — fireballs in flight and blasts still burning. */
  get active(): number {
    return this.effects.length;
  }

  update(ctx: FrameContext): void {
    for (const effect of [...this.effects]) {
      if (effect.kind === "flight") {
        this.updateFlight(effect, ctx);
      } else if (effect.kind === "blast") {
        this.updateBlast(effect, ctx);
      } else {
        this.updateNova(effect, ctx);
      }
    }
  }

  private updateFlight(flight: Flight, ctx: FrameContext): void {
    const blocked = (point: PlanetPoint): boolean =>
      terrainAt(point) === "rock" || this.hitTest(toLocal(ctx.pose, point));
    const burst = flyFireball(flight.ball, ctx.deltaMs, blocked);
    if (burst !== null) {
      this.detonate(burst, flight.ball.seed, ctx);
    }
    if (fireballSpent(flight.ball)) {
      this.retire(flight);
      return;
    }
    const origin = groundFoot(ctx.frame, toLocal(ctx.pose, flight.ball.origin));
    const left = origin.x - flight.originX;
    const top = origin.y - flight.originY;
    const at = fireballOffset(flight.ball);
    const ballRow = localRow(ctx.frame, toLocal(ctx.pose, fireballPoint(flight.ball)));
    flight.surface.clear().paint(fireballCloud(flight.ball), flight.originX, flight.originY).commit();
    flight.surface.image
      .setPosition(left, top)
      .setDepth(Math.round(ballRow) * TILE_WIDTH + RANK.actor)
      .setVisible(true);
    const light = fireballLight(flight.ball, origin.x + at.x, origin.y + at.y);
    if (light !== null) {
      ctx.lights.push(light);
    }
  }

  private updateBlast(blast: Blast, ctx: FrameContext): void {
    const local = toLocal(ctx.pose, blast.at);
    const foot = groundFoot(ctx.frame, local);
    stepExplosion(blast.explosion, ctx.deltaMs, windAt(ctx.elapsedMs, foot.x, foot.y, ctx.wind));
    if (explosionDone(blast.explosion)) {
      this.retire(blast);
      return;
    }
    const shown = onField(ctx.frame, foot, ctx.width, ctx.height, SURFACE_WIDTH);
    blast.surface.image.setVisible(shown);
    if (!shown) {
      return;
    }
    blast.surface.clear().paint(explosionCloud(blast.explosion), BLAST_FOOT_X, BLAST_FOOT_Y).commit();
    blast.surface.image
      .setPosition(foot.x - BLAST_FOOT_X, foot.y - BLAST_FOOT_Y)
      .setDepth(Math.round(localRow(ctx.frame, local)) * TILE_WIDTH + RANK.actor);
    const light = explosionLight(blast.explosion, foot.x, foot.y);
    if (light !== null) {
      ctx.lights.push(light);
    }
  }

  private updateNova(nova: Nova, ctx: FrameContext): void {
    const local = toLocal(ctx.pose, nova.at);
    const foot = groundFoot(ctx.frame, local);
    stepFrostNova(nova.nova, ctx.deltaMs);
    // The crack is the decal layer's; this surface only carries the ring and
    // the shards, which are done long before the crack fades.
    if (frostNovaDone(nova.nova) || nova.nova.ageMs > 700) {
      this.retire(nova);
      return;
    }
    nova.surface
      .clear()
      .paint([...novaRingCloud(nova.nova.ageMs), ...particleCloud(nova.nova.shards)], BLAST_FOOT_X, BLAST_FOOT_Y)
      .commit();
    nova.surface.image
      .setPosition(foot.x - BLAST_FOOT_X, foot.y - BLAST_FOOT_Y)
      .setDepth(Math.round(localRow(ctx.frame, local)) * TILE_WIDTH + RANK.actor + 1)
      .setVisible(onField(ctx.frame, foot, ctx.width, ctx.height, SURFACE_WIDTH));
    const light = frostNovaLight(nova.nova, foot.x, foot.y);
    if (light !== null) {
      ctx.lights.push(light);
    }
  }

  /** The burst: an explosion, a kick, a blow and a scar, all on the same frame. */
  private detonate(at: PlanetPoint, seed: number, ctx: FrameContext): void {
    this.add({ kind: "blast", explosion: createExplosion(seed + 7), at, surface: this.borrow() });
    ctx.impulse.shake(2.5, 250);
    ctx.impulse.hitStop(40);
    this.strikes.push({
      at: toLocal(ctx.pose, at),
      radius: BLAST_RADIUS,
      damage: BLAST_DAMAGE,
      element: "fire",
      force: BLAST_FORCE,
    });
    this.decals?.stamp(at, "scorch", seed + 13);
  }

  private add(effect: Effect): void {
    this.effects.push(effect);
    while (this.effects.length > EFFECT_CAP) {
      const oldest = this.effects[0];
      if (oldest === undefined) {
        break;
      }
      this.retire(oldest);
    }
  }

  private retire(effect: Effect): void {
    const index = this.effects.indexOf(effect);
    if (index >= 0) {
      this.effects.splice(index, 1);
    }
    effect.surface.image.setVisible(false);
    this.idle.push(effect.surface);
  }

  private borrow(): PixelSurface {
    const surface = this.idle.pop() ?? new PixelSurface(this.scene, SURFACE_WIDTH, SURFACE_HEIGHT, "fireball");
    surface.image.setVisible(false);
    return surface;
  }

  destroy(): void {
    for (const effect of this.effects) {
      effect.surface.destroy();
    }
    for (const surface of this.idle) {
      surface.destroy();
    }
    this.effects.length = 0;
    this.idle.length = 0;
  }
}
