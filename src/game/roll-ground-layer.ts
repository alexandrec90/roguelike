/**
 * The wiring for `roll-ground.ts`: one `PixelSurface` over the roll, repainted
 * every frame.
 *
 * It sits at the horizon band's depth, over the tile rows that hang above
 * `groundTop` and under everything standing (`sky-layer.ts` stops at the
 * horizon line and leaves this band to it). What a cell shows is the ground
 * layer's own answer - the lattice sampled for the pose, and the Wang ground
 * tile its keys pick - read cell by cell as the lip first shows a
 * cell, and kept until the pose changes. The lip's lattice inherits the field's node hashes where
 * the two overlap, so the cell the seam cuts through is the same tile on both
 * sides of it.
 *
 * Only the tufts on the first few rows past the seam sway. Beyond `LIVE_ROWS`
 * a row is a scanline or two tall and a blade's lean cannot be seen, while a
 * scanline there crosses a hundred cells - so those tufts are held upright and
 * stamped into the grass overlay (`roll-grass.ts`) once a step; a frame
 * forgets and re-stamps only the swaying rows.
 *
 * What it knows about one anchor is a `LipState` (`roll-ground-state.ts`), and
 * it keeps two: the anchor on screen, and the one the hero is walking into,
 * built and warmed a band of scanlines at a time in the frames before he gets
 * there (`prefetchTasks`), so the frame that crosses the tile finds it ready.
 *
 * The ground is drawn in daylight colours and lit by the lighting pass like the
 * field; only the haze it dissolves into is pre-divided (`unlitHaze`), so it
 * meets the sky in the sky's own colour.
 *
 * A far pixel shows its cell's far look (`CellLook.far`), chosen by what the
 * cell is made of, read off the planet at its own sample point - one terrain
 * lookup, never the
 * lattice round it, which is what the lazy sample exists to avoid reading. The
 * puddles out there are grown once a step (`roll-water.ts`). Anything standing
 * on the lip - a tree, a landform - is drawn over it by its own layer.
 */

import type { Scene } from "../engine";

import type { CameraFrame, LocalBounds } from "./camera";
import { terrainFarLooks } from "./far-looks";
import type { FrameContext } from "./frame-context";
import { groundKey } from "./ground/ground-plan";
import {
  DIRT,
  GRASS,
  prefetchGroundSample,
  sharedGroundSample,
  type GroundSample,
  type TerrainCode,
} from "./ground/ground-sample";
import { groundTile, unpackGroundKey } from "./ground/ground-tiles";
import { TUFT_SHAPES, tuftCloud, tuftFrame } from "./ground/tufts";
import { PixelSurface } from "./pixel-surface";
import { LipGpu } from "./roll-ground-gpu";
import type { PlanetPose } from "./planet";
import { HORIZON_DEPTH, TILE_DEPTH } from "./projection";
import type { Puddle } from "./puddles";
import type { FarLook } from "./roll-far";
import { gridTexels, lipBounds, rollGroundPixels, type TileTexels } from "./roll-ground";
import { packCloud, tuftBounds, type PackedCloud } from "./roll-grass";
import { LipState, type LipArt } from "./roll-ground-state";
import { LipWater, puddleOnLip } from "./roll-water";
import { unlitHaze } from "./sky-paint";
import { growPuddles } from "./water-layer";
import { reflectionKey, skyKey, skyReflection, type SkyReflection } from "./water/sky-inks";

/** Rows past the seam over which the lip's grass still sways with the field's. */
const LIVE_ROWS = 3;

/** Distinct tiles kept as texels; past it the oldest are let go a batch at a time. */
const TILE_LIMIT = 4096;
const TILE_EVICT = 512;

/**
 * Bands of scanlines a lip ahead is warmed in, one a task: small enough that
 * no one frame carries much of it, few enough to finish well inside the ten
 * or so frames between two tile crossings.
 */
const WARM_BANDS = 6;

/**
 * What each kind of ground looks like from too far to see its tile: the
 * meadow counted as the field draws it, grass and all (`far-looks.ts`).
 * Worked out once.
 */
let farLooks: Readonly<Record<TerrainCode, FarLook>> | undefined;

function farLookOf(code: TerrainCode): FarLook {
  farLooks ??= terrainFarLooks();
  return farLooks[code];
}

export class RollGroundLayer {
  private surface: PixelSurface | undefined;
  /** The GPU lip, when the scene draws on the GPU; the CPU surface otherwise. */
  private gpu: LipGpu | undefined;
  private scene: Scene | undefined;
  private useGpu = false;
  private frame: CameraFrame | undefined;
  private width = 0;
  private field: LocalBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private bounds: LocalBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private grassBounds: LocalBounds = { minX: 0, maxX: -1, minY: 0, maxY: -1 };
  /** The farthest cell row whose tufts still sway: `LIVE_ROWS` past the seam. */
  private liveMaxY = 0;
  /** The anchor on screen, and the one the hero is walking into. */
  private state: LipState | undefined;
  private ahead: LipState | undefined;
  private readonly tiles = new Map<number, TileTexels>();
  private readonly clouds = new Map<number, PackedCloud>();
  private readonly art: LipArt = {
    tile: (sample, cellX, cellY) => this.tile(sample, cellX, cellY),
    tuft: (shape, bend) => this.tuftAt(shape, bend),
    far: farLookOf,
  };
  private water: LipWater | undefined;
  private waterKey = "";
  private waterPose: PlanetPose | undefined;
  /** The puddles grown ahead for the anchor the hero is walking into, and the water made of them. */
  private aheadPuddles: { readonly pose: PlanetPose; readonly scale: number; readonly puddles: Puddle[] } | undefined;
  private aheadWater: { readonly pose: PlanetPose; readonly key: string; readonly water: LipWater } | undefined;
  private sky: SkyReflection | undefined;
  private atmosphereKey = "";
  /** The last frame's cost, ms - read it from the console when profiling. */
  lastFrameMs = 0;

  /** `gpu` draws the lip in a shader (`roll-ground-gpu.ts`); the CPU paints it otherwise. */
  create(scene: Scene, frame: CameraFrame, width: number, field: LocalBounds, gpu = false): void {
    this.width = width;
    this.scene = scene;
    this.useGpu = gpu;
    // Counting the far looks is tens of milliseconds: pay it at load, not on the first frame of lip.
    farLookOf(GRASS);
    this.layout(frame, field);
    if (frame.rollHeight <= 0 || gpu) {
      return;
    }
    this.surface = new PixelSurface(scene, width, frame.rollHeight, "roll-ground");
    this.surface.image.setPosition(0, frame.groundTop - frame.rollHeight).setDepth(HORIZON_DEPTH);
  }

  /** Re-cut after a resize moved the anchor, and with it where the seam falls. */
  layout(frame: CameraFrame, field: LocalBounds): void {
    const flat = { ...frame, phaseX: 0, phaseY: 0 };
    this.frame = flat;
    this.field = field;
    this.bounds = lipBounds(flat, this.width);
    this.grassBounds = tuftBounds(flat, this.width);
    this.liveMaxY = Math.floor((flat.footY - flat.groundTop) / TILE_DEPTH) + LIVE_ROWS;
    this.state = undefined;
    this.ahead = undefined;
    this.water = undefined;
    this.aheadWater = undefined;
    this.aheadPuddles = undefined;
    // The GPU lip's tables are cut to these bounds: a new cut is a new lip.
    this.gpu?.destroy();
    this.gpu =
      this.useGpu && this.scene !== undefined && flat.rollHeight > 0
        ? new LipGpu(this.scene, this.width, flat, this.bounds, this.grassBounds, [farLookOf(GRASS), farLookOf(DIRT)])
        : undefined;
  }

  /**
   * Repaint. Every frame, because the tufts on the lip sway in the same wind as
   * the ones on the field; a tuft that froze as it crossed the seam would be the
   * seam.
   */
  update(ctx: FrameContext, puddleScale = 1): void {
    const started = performance.now();
    if (this.gpu !== undefined) {
      const state = this.stateFor(ctx.pose);
      this.gpu.render(ctx, state, this.waterFor(ctx, puddleScale), this.liveMaxY, unlitHaze(ctx.atmosphere));
      this.lastFrameMs = performance.now() - started;
      return;
    }
    const surface = this.surface;
    if (surface === undefined) {
      return;
    }
    const state = this.stateFor(ctx.pose);
    // The swaying rows are stamped afresh; everything past them is still in.
    state.grass.forget(state.grass.bounds.minY, this.liveMaxY);
    const look = state.look(this.waterFor(ctx, puddleScale), this.liveMaxY, ctx);
    surface.buffer.data.set(rollGroundPixels(ctx.frame, this.width, look, unlitHaze(ctx.atmosphere)));
    surface.touch().commit();
    this.lastFrameMs = performance.now() - started;
  }

  /**
   * The work for the anchor the hero is walking into, as tasks to run in the
   * frames before he gets there: grow its puddles, then draw its lip once off
   * screen a band at a time, which reads its lattice, makes its tiles and
   * stamps its upright tufts - everything the frame that crosses would
   * otherwise do from nothing.
   */
  prefetchTasks(ctx: FrameContext, pose: PlanetPose, scale: number): (() => void)[] {
    if ((this.surface === undefined && this.gpu === undefined) || this.state?.pose === pose) {
      return [];
    }
    const gpu = this.gpu;
    if (gpu !== undefined && this.frame !== undefined) {
      return [
        () => this.prefetchPuddles(ctx, pose, scale),
        () => this.prefetchWater(ctx, pose, scale),
        ...gpu.warmTasks(
          this.aheadState(pose),
          () => (this.aheadWater?.pose === pose ? this.aheadWater.water : undefined),
          this.frame,
          this.liveMaxY,
        ),
      ];
    }
    const height = Math.max(ctx.frame.rollHeight, 0);
    const band = Math.ceil(height / WARM_BANDS);
    return [
      () => this.prefetchWater(ctx, pose, scale),
      ...Array.from({ length: WARM_BANDS }, (_unused, index) => () => this.warm(ctx, pose, scale, index * band, (index + 1) * band)),
    ];
  }

  /** The state for the anchor the hero is walking into, begun on the field's sample taken ahead. */
  private aheadState(pose: PlanetPose): LipState {
    if (this.ahead?.pose !== pose) {
      this.ahead = new LipState(pose, this.bounds, prefetchGroundSample(pose, this.field), this.grassBounds, this.art);
    }
    return this.ahead;
  }

  private prefetchWater(ctx: FrameContext, pose: PlanetPose, scale: number): void {
    if (this.waterPose === pose || this.aheadWater?.pose === pose) {
      return;
    }
    const sky = this.skyFor(ctx.atmosphere);
    this.aheadWater = { pose, key: `${scale}|${reflectionKey(sky)}`, water: this.growWater(ctx.frame, pose, scale, sky) };
  }

  /** Draw scanlines `from..to` of the lip ahead, as it will stand the moment he arrives, and throw the pixels away. */
  private warm(ctx: FrameContext, pose: PlanetPose, scale: number, from: number, to: number): void {
    const ahead = this.aheadState(pose);
    this.prefetchWater(ctx, pose, scale);
    const water = this.aheadWater?.pose === pose ? this.aheadWater.water : undefined;
    if (water === undefined) {
      return;
    }
    const arrival = { ...ctx.frame, phaseX: 0, phaseY: 0 };
    rollGroundPixels(arrival, this.width, ahead.look(water, this.liveMaxY), unlitHaze(ctx.atmosphere), { from, to });
  }

  /**
   * The lip's state for a pose: the one on screen, the one warmed ahead for it,
   * or a fresh one - begun once a step and inheriting the field's hashes, read
   * on demand, since a frame reads a tenth of the cells out to the horizon.
   */
  private stateFor(pose: PlanetPose): LipState {
    if (this.state?.pose === pose) {
      return this.state;
    }
    // Called first so the field's sample taken ahead becomes the one on screen either way.
    const base = sharedGroundSample(pose, this.field);
    this.state =
      this.ahead?.pose === pose ? this.ahead : new LipState(pose, this.bounds, base, this.grassBounds, this.art);
    this.ahead = undefined;
    return this.state;
  }

  /**
   * The puddles out on the lip, re-grown when the pose, their size or the sky
   * they mirror moved on - what the water layer re-grows and re-bakes for too.
   */
  private waterFor(ctx: FrameContext, scale: number): LipWater {
    const sky = this.skyFor(ctx.atmosphere);
    const key = `${scale}|${reflectionKey(sky)}`;
    if (this.water === undefined || this.waterKey !== key || this.waterPose !== ctx.pose) {
      const ahead = this.aheadWater;
      this.water =
        ahead?.pose === ctx.pose && ahead.key === key ? ahead.water : this.growWater(ctx.frame, ctx.pose, scale, sky);
      this.aheadWater = undefined;
      this.waterKey = key;
      this.waterPose = ctx.pose;
    }
    return this.water;
  }

  /** The sky the puddles mirror, re-read only when the atmosphere has moved on. */
  private skyFor(atmosphere: FrameContext["atmosphere"]): SkyReflection {
    const atmosphereKey = skyKey(atmosphere);
    if (atmosphereKey !== this.atmosphereKey || this.sky === undefined) {
      this.atmosphereKey = atmosphereKey;
      this.sky = skyReflection(atmosphere);
    }
    return this.sky;
  }

  private growWater(frame: CameraFrame, pose: PlanetPose, scale: number, sky: SkyReflection): LipWater {
    return new LipWater({ ...frame, phaseX: 0, phaseY: 0 }, this.lipPuddles(frame, pose, scale), sky);
  }

  /**
   * The puddles out on the lip for a pose - grown ahead in a task of their own
   * (`prefetchPuddles`), the sweep being half the cost of the lip's water.
   */
  private lipPuddles(frame: CameraFrame, pose: PlanetPose, scale: number): Puddle[] {
    const ahead = this.aheadPuddles;
    if (ahead?.pose === pose && ahead.scale === scale) {
      return ahead.puddles;
    }
    const flat = { ...frame, phaseX: 0, phaseY: 0 };
    const { minX, maxX, minY, maxY } = this.bounds;
    const around = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const reach = Math.ceil(Math.hypot((maxX - minX) / 2, (maxY - minY) / 2)) + 1;
    return growPuddles(flat, pose, reach, scale, {
      keep: (local) => puddleOnLip(flat, this.width, local),
      around,
    });
  }

  private prefetchPuddles(ctx: FrameContext, pose: PlanetPose, scale: number): void {
    if (this.waterPose === pose || this.aheadWater?.pose === pose) {
      return;
    }
    this.aheadPuddles = { pose, scale, puddles: this.lipPuddles(ctx.frame, pose, scale) };
  }

  /** The tile the ground layer composes in a cell. */
  private tile(sample: GroundSample, cellX: number, cellY: number): TileTexels {
    const key = groundKey(sample, cellX, cellY);
    let texels = this.tiles.get(key);
    if (texels === undefined) {
      if (this.tiles.size >= TILE_LIMIT) {
        // The oldest first, a batch at a time: clearing the lot at once made
        // the next frame compose every tile on the lip from nothing.
        const keys = this.tiles.keys();
        for (let count = 0; count < TILE_EVICT; count += 1) {
          const oldest = keys.next();
          if (oldest.done === true) {
            break;
          }
          this.tiles.delete(oldest.value);
        }
      }
      texels = gridTexels(groundTile(unpackGroundKey(key)));
      this.tiles.set(key, texels);
    }
    return texels;
  }

  /** A tuft at a bend, packed once: there are only `TUFT_SHAPES × BEND_FRAMES` of them. */
  private tuftAt(shape: number, bend: number): PackedCloud {
    const frame = tuftFrame(shape, bend);
    let cloud = this.clouds.get(frame);
    if (cloud === undefined) {
      const tuft = TUFT_SHAPES[shape];
      cloud = packCloud(tuft === undefined ? [] : tuftCloud(tuft, bend));
      this.clouds.set(frame, cloud);
    }
    return cloud;
  }
}
