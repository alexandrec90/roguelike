/**
 * The playfield, scrolling and turning under a grid that never moves.
 *
 * The layer is built on the split `camera.ts` describes. Art is laid out on the
 * zero-phase grid and thereafter only ever *moved by an image position*; what
 * each cell shows is re-sampled only when a step completes and the pose the
 * world is read from advances:
 *
 *     per frame : ground image <- scrollOffset(frame)               (one write)
 *     per step  : lattice sample -> tile keys -> copy tiles -> one upload
 *
 * The flat ground is **one** `PixelSurface` the size of the grid: every cell's
 * tile is copied into it word by word when the pose changes, and it reaches the
 * GPU as one texture and one quad. The previous build drew four hundred images
 * for the same picture.
 *
 * What the tiles look like, and why they meet without seams, is `ground/`:
 * `ground-sample.ts` (the planet on a half-tile lattice), `ground-plan.ts`
 * (which tile where), `ground-tiles.ts` (the art), `wang.ts` (why neighbours
 * agree). The ground is flat: what stands on it is a landform or a body.
 */

import Phaser from "phaser";

import { localOrigin, scrollOffset, type CameraFrame, type LocalBounds } from "./camera";
import type { FrameContext } from "./frame-context";
import { planGround, type GroundPlan } from "./ground/ground-plan";
import { sharedGroundSample } from "./ground/ground-sample";
import { groundTile, unpackGroundKey } from "./ground/ground-tiles";
import { blitWords, createTileCache, type TileCache, type WordTarget } from "./ground/tile-cache";
import { PixelSurface } from "./pixel-surface";
import type { PlanetPose } from "./planet";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";

/** Behind everything that stands on it. */
export const GROUND_DEPTH = -1000;

/** Seconds of steady rain to soak the ground, and of dry weather to lose it. */
const SOAK_MS = 6000;
const DRY_MS = 30000;

/** Milliseconds of never-seen tiles a walking step may generate before deferring the rest. */
const BAKE_BUDGET_MS = 1.5;

function wordTarget(surface: PixelSurface): WordTarget {
  return {
    width: surface.width,
    height: surface.height,
    words: new Uint32Array(surface.buffer.data.buffer),
  };
}

export class GroundLayer {
  private scene!: Phaser.Scene;
  private ground: PixelSurface | undefined;
  private groundTarget: WordTarget | undefined;
  private bounds: LocalBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  /** Screen top-left of the grid's top-left cell, on the zero-phase grid. */
  private origin = { x: 0, y: 0 };
  private flat: CameraFrame | undefined;
  private sampled: PlanetPose | undefined;
  /** A plan whose tiles did not all fit in last frame's bake budget. */
  private pending: GroundPlan | undefined;
  private wetness = 0;
  private readonly groundTiles: TileCache = createTileCache(TILE_WIDTH, TILE_DEPTH, (key) =>
    groundTile(unpackGroundKey(key)),
  );
  /** The last resample's cost, ms - read it from the console when profiling. */
  lastResampleMs = 0;

  create(scene: Phaser.Scene, frame: CameraFrame, bounds: LocalBounds): void {
    this.scene = scene;
    this.layout(frame, bounds);
  }

  /**
   * (Re)build the surfaces for a grid of this size.
   *
   * Called again on every resize, because the window decides how many rows
   * survive the cover crop and therefore how much grid there is to fill.
   */
  layout(frame: CameraFrame, bounds: LocalBounds): void {
    this.destroySurfaces();
    this.bounds = bounds;
    this.flat = { ...frame, phaseX: 0, phaseY: 0 };
    this.origin = localOrigin(this.flat, { x: bounds.minX, y: bounds.maxY });
    const columns = bounds.maxX - bounds.minX + 1;
    const rows = bounds.maxY - bounds.minY + 1;
    this.ground = new PixelSurface(this.scene, columns * TILE_WIDTH, rows * TILE_DEPTH, "ground");
    this.ground.image.setDepth(GROUND_DEPTH);
    this.groundTarget = wordTarget(this.ground);
    this.sampled = undefined;
    this.pending = undefined;
    this.applyWetness();
  }

  /**
   * One frame. The scroll always; the sampling only when the world has turned
   * or moved on to the next cell.
   */
  draw(frame: CameraFrame, pose: PlanetPose): void {
    if (this.sampled !== pose) {
      const started = performance.now();
      // The first paint of a layout is unbudgeted: a field that fills in over
      // twenty frames on load looks broken, where a margin cell that catches up
      // a frame late on a walk is never seen.
      this.resample(pose, this.sampled === undefined ? Number.POSITIVE_INFINITY : BAKE_BUDGET_MS);
      this.sampled = pose;
      this.lastResampleMs = performance.now() - started;
    } else if (this.pending !== undefined) {
      const plan = this.pending;
      this.pending = undefined;
      this.paintGround(plan, BAKE_BUDGET_MS);
    }
    const offset = scrollOffset(frame);
    this.ground?.image.setPosition(this.origin.x + offset.x, this.origin.y + offset.y);
  }

  /**
   * The frame-context form: draw, and let the ground soak up the rain.
   *
   * Wetness follows `ctx.rain` with a lag - quick to soak, slow to dry - so a
   * shower that stops leaves the ground dark for a while, as it does.
   */
  update(ctx: FrameContext): void {
    this.draw(ctx.frame, ctx.pose);
    const rate = ctx.rain > this.wetness ? ctx.deltaMs / SOAK_MS : ctx.deltaMs / DRY_MS;
    const next = this.wetness + Math.sign(ctx.rain - this.wetness) * Math.min(rate, Math.abs(ctx.rain - this.wetness));
    this.setWetness(next);
  }

  /**
   * 0 is dry, 1 is soaked: wet ground is darker and cooler.
   *
   * A multiply tint on the ground image - lighting, not new art, so
   * it costs nothing and cannot drift off the palette the tiles were baked in.
   */
  setWetness(wetness: number): void {
    const clamped = Math.min(Math.max(wetness, 0), 1);
    if (Math.abs(clamped - this.wetness) < 0.004 && clamped !== 0 && clamped !== 1) {
      return;
    }
    this.wetness = clamped;
    this.applyWetness();
  }

  destroy(): void {
    this.destroySurfaces();
  }

  private applyWetness(): void {
    const w = this.wetness;
    const channel = (loss: number): number => Math.round(255 * (1 - loss * w));
    const tint = (channel(0.3) << 16) | (channel(0.26) << 8) | channel(0.16);
    this.ground?.image.setTint(tint);
  }

  /**
   * Read the planet through the frame and repaint what changed.
   *
   * `fromLocal` is the rotation, and it is applied per lattice point rather
   * than to the grid: the grid stays axis-aligned and only what lands in each
   * cell changes, which is the entire reason a camera may turn in a game with
   * this pixel contract.
   */
  private resample(pose: PlanetPose, budgetMs: number): void {
    const plan = planGround(sharedGroundSample(pose, this.bounds));
    this.paintGround(plan, budgetMs);
  }

  /**
   * Copy every cell's tile into the ground surface, generating at most
   * `budgetMs` of tiles it has never seen. A cell whose tile missed the budget
   * keeps last step's pixels for a frame and the plan is finished next frame -
   * new tiles arrive at the grid's margin, which is off screen.
   */
  private paintGround(plan: GroundPlan, budgetMs: number): void {
    const target = this.groundTarget;
    if (target === undefined || this.ground === undefined) {
      return;
    }
    this.pending = undefined;
    const deadline = performance.now() + budgetMs;
    for (const cell of plan.ground) {
      let tile = this.groundTiles.peek(cell.key);
      if (tile === undefined && performance.now() < deadline) {
        tile = this.groundTiles.get(cell.key);
      }
      if (tile === undefined) {
        this.pending = plan;
        continue;
      }
      blitWords(target, tile, TILE_WIDTH, cell.x, cell.y, true);
    }
    this.ground.touch().commit();
  }

  private destroySurfaces(): void {
    this.ground?.destroy();
    this.ground = undefined;
    this.groundTarget = undefined;
  }
}
