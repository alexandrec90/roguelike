/**
 * The playfield, scrolling and turning under a grid that never moves.
 *
 * The layer is built on the split `camera.ts` describes. Art is laid out on the
 * zero-phase grid and thereafter only ever *moved by an image position*; what
 * each cell shows is re-sampled only when a step completes and the pose the
 * world is read from advances:
 *
 *     per frame : ground image, rock rows <- scrollOffset(frame)   (a few writes)
 *     per step  : lattice sample -> tile keys -> copy tiles -> one upload each
 *
 * The flat ground is **one** `PixelSurface` the size of the grid: every cell's
 * tile is copied into it word by word when the pose changes, and it reaches the
 * GPU as one texture and one quad. The previous build drew four hundred images
 * for the same picture.
 *
 * Rock cannot join it, because rock stands up and must sort against the hero
 * and the trees. It keeps the old rule - one image per *screen row*, on the
 * scene's shared `row * TILE_WIDTH + rank` key - but each row is now a surface
 * holding that row's caps and faces, re-uploaded only when its content changed.
 * Screen rows are the right key because the grid is bolted to the screen: only
 * the phase slides things inside a row, never between rows.
 *
 * What the tiles look like, and why they meet without seams, is `ground/`:
 * `ground-sample.ts` (the planet on a half-tile lattice), `ground-plan.ts`
 * (which tile where), `ground-tiles.ts` and `rock-tiles.ts` (the art),
 * `wang.ts` (why neighbours agree).
 */

import Phaser from "phaser";

import {
  localOrigin,
  localRow,
  scrollOffset,
  standsOnField,
  type CameraFrame,
  type LocalBounds,
} from "./camera";
import type { FrameContext } from "./frame-context";
import { FACE_TOP, planGround, ROCK_ROW_HEIGHT, rowSignature, type GroundPlan, type RockRowPlan } from "./ground/ground-plan";
import { sharedGroundSample } from "./ground/ground-sample";
import { groundTile, unpackGroundKey } from "./ground/ground-tiles";
import { capTile, faceTile, unpackCapKey, unpackFaceKey } from "./ground/rock-tiles";
import { blitWords, createTileCache, type TileCache, type WordTarget } from "./ground/tile-cache";
import { PixelSurface } from "./pixel-surface";
import type { PlanetPose } from "./planet";
import { RANK, TILE_DEPTH, TILE_WIDTH, WALL_RISE } from "./projection";

/** Behind everything that stands on it. */
export const GROUND_DEPTH = -1000;

/** Seconds of steady rain to soak the ground, and of dry weather to lose it. */
const SOAK_MS = 6000;
const DRY_MS = 30000;

/** Milliseconds of never-seen tiles a walking step may generate before deferring the rest. */
const BAKE_BUDGET_MS = 1.5;

interface RockRow {
  readonly surface: PixelSurface;
  readonly target: WordTarget;
  signature: string;
  /** Whether the row has any rock in it at all. */
  filled: boolean;
}

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
  private rockRows: (RockRow | undefined)[] = [];
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
  private readonly capTiles: TileCache = createTileCache(TILE_WIDTH, TILE_DEPTH, (key) =>
    capTile(unpackCapKey(key)),
  );
  private readonly faceTiles: TileCache = createTileCache(TILE_WIDTH, WALL_RISE, (key) =>
    faceTile(unpackFaceKey(key)),
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
    this.rockRows = Array.from({ length: rows }, () => undefined);
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
    this.rockRows.forEach((row, index) => {
      if (row !== undefined) {
        const top = this.origin.y + (this.rows() - 1 - index) * TILE_DEPTH - WALL_RISE + offset.y;
        row.surface.image.setPosition(this.origin.x + offset.x, top);
        // A row whose foot has crossed the seam is the horizon roll's to stand
        // up (`roll-rock.ts`); drawn here too it was a full-size wall floating
        // over the roll with the sky behind it.
        row.surface.image.setVisible(row.filled && standsOnField(top + ROCK_ROW_HEIGHT, frame));
      }
    });
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
   * A multiply tint on the ground and rock images - lighting, not new art, so
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
    for (const row of this.rockRows) {
      row?.surface.image.setTint((channel(0.22) << 16) | (channel(0.2) << 8) | channel(0.12));
    }
  }

  private rows(): number {
    return this.bounds.maxY - this.bounds.minY + 1;
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
    plan.rockRows.forEach((row, index) => this.paintRockRow(row, index));
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

  private paintRockRow(plan: RockRowPlan, index: number): void {
    const signature = rowSignature(plan);
    let row = this.rockRows[index];
    if (row?.signature === signature) {
      return;
    }
    if (plan.caps.length === 0) {
      if (row !== undefined) {
        row.signature = signature;
        row.filled = false;
        row.surface.image.setVisible(false);
      }
      return;
    }
    row ??= this.createRockRow(plan.localY, index);
    row.signature = signature;
    row.target.words.fill(0);
    for (const cap of plan.caps) {
      blitWords(row.target, this.capTiles.get(cap.key), TILE_WIDTH, cap.x, cap.y, false);
    }
    for (const face of plan.faces) {
      blitWords(row.target, this.faceTiles.get(face.key), TILE_WIDTH, face.x, FACE_TOP, false);
    }
    row.surface.touch().commit();
    row.filled = true;
  }

  private createRockRow(localY: number, index: number): RockRow {
    const width = (this.bounds.maxX - this.bounds.minX + 1) * TILE_WIDTH;
    const surface = new PixelSurface(this.scene, width, ROCK_ROW_HEIGHT, "rock-row");
    const flat = this.flat ?? { groundTop: 0, rollHeight: 0, footX: 0, footY: 0, phaseX: 0, phaseY: 0 };
    surface.image.setDepth(Math.round(localRow(flat, { x: 0, y: localY })) * TILE_WIDTH + RANK.cap);
    const row: RockRow = { surface, target: wordTarget(surface), signature: "", filled: false };
    this.rockRows[index] = row;
    this.applyWetness();
    return row;
  }

  private destroySurfaces(): void {
    this.ground?.destroy();
    this.ground = undefined;
    this.groundTarget = undefined;
    for (const row of this.rockRows) {
      row?.surface.destroy();
    }
    this.rockRows = [];
  }
}
