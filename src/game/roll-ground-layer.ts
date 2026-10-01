/**
 * The wiring for `roll-ground.ts`: one `PixelSurface` over the roll, repainted
 * every frame.
 *
 * It sits at the horizon band's depth, over the tile rows that hang above
 * `groundTop` and under everything standing (`sky-layer.ts` stops at the
 * horizon line and leaves this band to it). What a cell shows is the ground
 * layer's own answer - the lattice sampled for the pose, and the Wang ground
 * tile or rock cap its keys pick - read cell by cell as the lip first shows a
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
 * The ground is drawn in daylight colours and lit by the lighting pass like the
 * field; only the haze it dissolves into is pre-divided (`unlitHaze`), so it
 * meets the sky in the sky's own colour.
 *
 * The surface spans the whole band above the field, not only the roll: rock
 * stands on the lip (`roll-rock.ts`), and a wall near the seam rises past the
 * horizon line into the sky. Above the roll it is transparent wherever no rock
 * rises. Which cells are rock is asked one cell at a time, off the planet, and
 * only a rock cell pays for its lattice - the march reads most of the cells out
 * to the horizon, and reading the lattice under all of them is what the lazy
 * sample exists to avoid. The puddles out there are grown once a step
 * (`roll-water.ts`).
 */

import type Phaser from "phaser";

import type { CameraFrame, LocalBounds } from "./camera";
import type { FrameContext } from "./frame-context";
import { capKey, faceKey, groundKey } from "./ground/ground-plan";
import {
  cachedTerrain,
  cellTerrain,
  DIRT,
  GRASS,
  lazyGroundSample,
  ROCK,
  sharedGroundSample,
  type GroundSample,
  type LazyGroundSample,
  type TerrainCode,
} from "./ground/ground-sample";
import { groundTile, unpackGroundKey } from "./ground/ground-tiles";
import { capTile, faceTile, unpackCapKey, unpackFaceKey } from "./ground/rock-tiles";
import { swayBend, tuftsInCell, type TuftPlacement } from "./ground/tuft-placement";
import { bendFrame, TUFT_SHAPES, tuftCloud, tuftFrame } from "./ground/tufts";
import { PixelSurface } from "./pixel-surface";
import { localFrame, type PlanetPoint, type PlanetPose } from "./planet";
import { HORIZON_DEPTH, TILE_DEPTH, TILE_WIDTH } from "./projection";
import { gridTexels, lipBounds, rollGroundPixels, tileMode, type TileTexels } from "./roll-ground";
import { packCloud, tuftBounds, TuftOverlay, type PackedCloud, type TuftPiece } from "./roll-grass";
import { faceTexels, paintRollRock, type RockLook } from "./roll-rock";
import { LipWater, puddleOnLip } from "./roll-water";
import { unlitHaze } from "./sky-paint";
import { growPuddles } from "./water-layer";
import { reflectionKey, skyKey, skyReflection, type SkyReflection } from "./water/sky-inks";
import { windAt } from "./wind";

/** Rows past the seam over which the lip's grass still sways with the field's. */
const LIVE_ROWS = 3;

/** Distinct tiles kept as texels before the cache starts again; a few walks' worth. */
const TILE_LIMIT = 4096;

/** A rock cap's key, kept apart from the ground keys in one map. */
const CAP_FLAG = 2 ** 30;

/**
 * What each kind of ground looks like from too far to see its tile: the
 * commonest colour of a plain tile of that kind. Worked out once.
 */
let farColours: Readonly<Record<TerrainCode, number>> | undefined;

function farColour(code: TerrainCode): number {
  farColours ??= {
    [GRASS]: tileMode(gridTexels(groundTile({ dirt: 0, colours: 0, middle: 0, shade: 0 }))),
    [DIRT]: tileMode(gridTexels(groundTile({ dirt: 0x1ff, colours: 0, middle: 0, shade: 0 }))),
    [ROCK]: tileMode(gridTexels(capTile({ rock: 15, colours: 0, middle: 0 }))),
  };
  return farColours[code];
}

let farFace: number | undefined;

/** A rock wall from too far to see its tiles: a plain cap's colour on top, a plain face's in front. */
function farRock(): { readonly cap: number; readonly face: number } {
  farFace ??= tileMode(faceTexels(faceTile({ openLeft: false, openRight: false, colours: 0, middle: 0 })));
  return { cap: farColour(ROCK), face: farFace };
}

interface LipCell {
  readonly tile: TileTexels;
  /** Each tuft's root inside the cell, from its far-left corner. */
  readonly tufts: readonly { readonly placement: TuftPlacement; readonly dx: number; readonly dy: number }[];
}

export class RollGroundLayer {
  private surface: PixelSurface | undefined;
  private width = 0;
  private field: LocalBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private bounds: LocalBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private sample: LazyGroundSample | undefined;
  private grass = new TuftOverlay({ minX: 0, maxX: -1, minY: 0, maxY: -1 });
  /** The farthest cell row whose tufts still sway: `LIVE_ROWS` past the seam. */
  private liveMaxY = 0;
  private readonly cells = new Map<number, LipCell>();
  private readonly tiles = new Map<number, TileTexels>();
  private readonly clouds = new Map<number, PackedCloud>();
  /** Per lip cell, its terrain code plus one - 0 for not yet asked; and each rock cell's look. */
  private terrain = new Uint8Array(0);
  /** Local to planet for the pose the lip was sampled at. */
  private toPlanet: ((x: number, y: number) => PlanetPoint) | undefined;
  private readonly rocks = new Map<number, RockLook>();
  private readonly faces = new Map<number, TileTexels>();
  private water: LipWater | undefined;
  private waterKey = "";
  private waterPose: PlanetPose | undefined;
  private sky: SkyReflection | undefined;
  private atmosphereKey = "";
  /** The last frame's cost, ms - read it from the console when profiling. */
  lastFrameMs = 0;

  create(scene: Phaser.Scene, frame: CameraFrame, width: number, field: LocalBounds): void {
    this.width = width;
    this.layout(frame, field);
    if (frame.rollHeight <= 0) {
      return;
    }
    this.surface = new PixelSurface(scene, width, frame.groundTop, "roll-ground");
    this.surface.image.setPosition(0, 0).setDepth(HORIZON_DEPTH);
  }

  /** Re-cut after a resize moved the anchor, and with it where the seam falls. */
  layout(frame: CameraFrame, field: LocalBounds): void {
    const flat = { ...frame, phaseX: 0, phaseY: 0 };
    this.field = field;
    this.bounds = lipBounds(flat, this.width);
    this.grass = new TuftOverlay(tuftBounds(flat, this.width));
    this.liveMaxY = Math.floor((flat.footY - flat.groundTop) / TILE_DEPTH) + LIVE_ROWS;
    this.sample = undefined;
    this.water = undefined;
  }

  /**
   * Repaint. Every frame, because the tufts on the lip sway in the same wind as
   * the ones on the field; a tuft that froze as it crossed the seam would be the
   * seam.
   */
  update(ctx: FrameContext, puddleScale = 1): void {
    const surface = this.surface;
    if (surface === undefined) {
      return;
    }
    const started = performance.now();
    const sample = this.sampleFor(ctx.pose);
    const grass = this.grass;
    const haze = unlitHaze(ctx.atmosphere);
    // The swaying rows are stamped afresh; everything past them is still in.
    grass.forget(grass.bounds.minY, this.liveMaxY);
    const ground = rollGroundPixels(
      ctx.frame,
      this.width,
      {
        tile: (cellX, cellY) => this.cell(sample, cellX, cellY).tile,
        tuft: (cellX, cellY) =>
          cellY <= this.liveMaxY ? this.swaying(sample, cellX, cellY, ctx) : this.upright(sample, cellX, cellY),
        grass,
        water: this.waterFor(ctx, puddleScale),
        far: (cellX, cellY) => farColour(this.terrainAt(sample, cellX, cellY)),
      },
      haze,
    );
    // The sky rows are clear but for rock; the roll's own rows are the ground.
    const band = surface.buffer.data;
    band.fill(0, 0, band.length - ground.length);
    band.set(ground, band.length - ground.length);
    paintRollRock(ctx.frame, this.width, (cellX, cellY) => this.rock(sample, cellX, cellY), haze, band);
    surface.touch().commit();
    this.lastFrameMs = performance.now() - started;
  }

  /**
   * The puddles out on the lip, re-grown when the pose, their size or the sky
   * they mirror moved on - what the water layer re-grows and re-bakes for too.
   */
  private waterFor(ctx: FrameContext, scale: number): LipWater {
    const atmosphereKey = skyKey(ctx.atmosphere);
    if (atmosphereKey !== this.atmosphereKey) {
      this.atmosphereKey = atmosphereKey;
      this.sky = skyReflection(ctx.atmosphere);
    }
    const sky = this.sky ?? skyReflection(ctx.atmosphere);
    const key = `${scale}|${reflectionKey(sky)}`;
    if (this.water === undefined || this.waterKey !== key || this.waterPose !== ctx.pose) {
      const flat = { ...ctx.frame, phaseX: 0, phaseY: 0 };
      const { minX, maxX, minY, maxY } = this.bounds;
      const around = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      const reach = Math.ceil(Math.hypot((maxX - minX) / 2, (maxY - minY) / 2)) + 1;
      const puddles = growPuddles(flat, ctx.pose, reach, scale, {
        keep: (local) => puddleOnLip(flat, this.width, local),
        around,
      });
      this.water = new LipWater(flat, puddles, sky);
      this.waterKey = key;
      this.waterPose = ctx.pose;
    }
    return this.water;
  }

  /**
   * Is the cell rock, and how does it look standing? Asked off the planet at
   * the cell's own sample point - exactly `cellTerrain`'s - so open ground,
   * which is most of the lip, never reads the lattice round it.
   */
  private rock(sample: GroundSample, cellX: number, cellY: number): RockLook | null {
    if (this.terrainAt(sample, cellX, cellY) !== ROCK) {
      return null;
    }
    const { minX, maxX, minY } = this.bounds;
    const index = (cellY - minY) * (maxX - minX + 1) + (cellX - minX);
    let look = this.rocks.get(index);
    if (look === undefined) {
      look = this.lazyRock(sample, cellX, cellY);
      this.rocks.set(index, look);
    }
    return look;
  }

  /**
   * A rock cell whose tiles are composed only when a pixel point-samples them.
   * Out toward the horizon every pixel shows the far colours instead, and the
   * lattice under the far wall is never read.
   */
  private lazyRock(sample: GroundSample, cellX: number, cellY: number): RockLook {
    let cap: TileTexels | undefined;
    let face: TileTexels | undefined;
    const tiles = {
      cap: (): TileTexels => (cap ??= this.cell(sample, cellX, cellY).tile),
      face: (): TileTexels => {
        // The face's key reads the lattice round the cell, which `cell` reads in.
        this.cell(sample, cellX, cellY);
        return (face ??= this.face(faceKey(sample, cellX, cellY)));
      },
    };
    return {
      get cap() {
        return tiles.cap();
      },
      get face() {
        return tiles.face();
      },
      far: farRock(),
    };
  }

  /**
   * What a lip cell is made of, read off the planet at the cell's own sample
   * point - exactly `cellTerrain`'s answer, without the lattice round it. Out
   * of the lip's bounds is open grass.
   */
  private terrainAt(sample: GroundSample, cellX: number, cellY: number): TerrainCode {
    const { minX, maxX, minY, maxY } = this.bounds;
    if (cellX < minX || cellX > maxX || cellY < minY || cellY > maxY) {
      return GRASS;
    }
    const index = (cellY - minY) * (maxX - minX + 1) + (cellX - minX);
    const known = this.terrain[index] ?? 0;
    if (known !== 0) {
      return (known - 1) as TerrainCode;
    }
    this.toPlanet ??= localFrame(sample.pose);
    const point = this.toPlanet(cellX, cellY);
    const code = cachedTerrain(point.x, point.y);
    this.terrain[index] = code + 1;
    return code;
  }

  private face(key: number): TileTexels {
    let face = this.faces.get(key);
    if (face === undefined) {
      face = faceTexels(faceTile(unpackFaceKey(key)));
      this.faces.set(key, face);
    }
    return face;
  }

  /**
   * The lip's lattice for a pose, begun once a step and inheriting the field's
   * hashes. Read on demand: a frame reads a tenth of the cells out to the
   * horizon, and reading them all cost ten times a step of the field.
   */
  private sampleFor(pose: PlanetPose): GroundSample {
    if (this.sample?.sample.pose !== pose) {
      this.sample = lazyGroundSample(pose, this.bounds, sharedGroundSample(pose, this.field));
      this.cells.clear();
      this.grass.reset();
      const { minX, maxX, minY, maxY } = this.bounds;
      this.terrain = new Uint8Array((maxX - minX + 1) * (maxY - minY + 1));
      this.rocks.clear();
      this.toPlanet = undefined;
    }
    return this.sample.sample;
  }

  private cell(sample: GroundSample, cellX: number, cellY: number): LipCell {
    const key = (cellX + 2048) * 4096 + (cellY + 2048);
    let cell = this.cells.get(key);
    if (cell === undefined) {
      this.sample?.readAround(cellX, cellY);
      const left = (cellX - sample.bounds.minX) * TILE_WIDTH;
      const top = (sample.bounds.maxY - cellY) * TILE_DEPTH;
      cell = {
        tile: this.tile(sample, cellX, cellY),
        tufts: tuftsInCell(sample, cellX, cellY).map((placement) => ({
          placement,
          dx: placement.x - left,
          dy: placement.y - top,
        })),
      };
      this.cells.set(key, cell);
    }
    return cell;
  }

  /** The tile the ground layer composes in a cell - a rock cap lies flat out here. */
  private tile(sample: GroundSample, cellX: number, cellY: number): TileTexels {
    const rock = cellTerrain(sample, cellX, cellY) === ROCK;
    const key = rock ? capKey(sample, cellX, cellY) + CAP_FLAG : groundKey(sample, cellX, cellY);
    let texels = this.tiles.get(key);
    if (texels === undefined) {
      if (this.tiles.size >= TILE_LIMIT) {
        this.tiles.clear();
      }
      texels = gridTexels(rock ? capTile(unpackCapKey(key - CAP_FLAG)) : groundTile(unpackGroundKey(key)));
      this.tiles.set(key, texels);
    }
    return texels;
  }

  /** Asked once a step per cell: the overlay keeps what it is given. */
  private upright(sample: GroundSample, cellX: number, cellY: number): readonly TuftPiece[] | null {
    return this.gather(this.cell(sample, cellX, cellY), () => bendFrame(0));
  }

  /**
   * The tufts bent by the wind, as the field bends them. Every tuft in a cell
   * names the cell's middle as its planet point, so one gust serves them all.
   */
  private swaying(
    sample: GroundSample,
    cellX: number,
    cellY: number,
    ctx: FrameContext,
  ): readonly TuftPiece[] | null {
    const cell = this.cell(sample, cellX, cellY);
    const first = cell.tufts[0]?.placement;
    if (first === undefined) {
      return null;
    }
    const gust = windAt(ctx.elapsedMs, first.planetX * TILE_WIDTH, first.planetY * TILE_WIDTH, ctx.wind);
    return this.gather(cell, (tuft) => bendFrame(swayBend(tuft, gust, ctx.elapsedMs)));
  }

  /** A cell's tufts at their bends, each placed from the cell's foot. */
  private gather(cell: LipCell, bend: (tuft: TuftPlacement) => number): readonly TuftPiece[] | null {
    if (cell.tufts.length === 0) {
      return null;
    }
    return cell.tufts.map(({ placement, dx, dy }) => ({
      cloud: this.tuftAt(placement.shape, bend(placement)),
      x: dx - TILE_WIDTH / 2,
      y: dy - TILE_DEPTH,
    }));
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
