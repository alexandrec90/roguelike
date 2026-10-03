/**
 * What the horizon lip knows about one anchor: the lattice read on demand
 * round it, each cell's tile and tufts, each cell's terrain, and the upright
 * tufts already stamped into the grass overlay.
 *
 * Split from `roll-ground-layer.ts` so there can be two: the anchor on screen,
 * and the one the hero is walking into, built and warmed in the frames before
 * he gets there (`prefetcher.ts`). Throwing all of this away and rebuilding it
 * on the frame that crossed a tile was what made that frame cost 10 to 22 ms
 * more than its neighbours.
 */

import type { LocalBounds } from "./camera";
import type { FrameContext } from "./frame-context";
import { cachedTerrain, GRASS, lazyGroundSample, type GroundSample, type LazyGroundSample, type TerrainCode } from "./ground/ground-sample";
import { swayBend, tuftsInCell, type TuftPlacement } from "./ground/tuft-placement";
import { bendFrame } from "./ground/tufts";
import { localFrame, type PlanetPoint, type PlanetPose } from "./planet";
import { TILE_DEPTH, TILE_WIDTH } from "./projection";
import { tuftAtlasFrame, type TuftEntry } from "./lip-gpu-data";
import type { FarLook } from "./roll-far";
import type { CellLook, TileTexels, WaterLook } from "./roll-ground";
import { TuftOverlay, type PackedCloud, type TuftPiece } from "./roll-grass";
import { windAt } from "./wind";

/** What every anchor's state shares: the tile art and the tuft pictures, cached across anchors. */
export interface LipArt {
  tile(sample: GroundSample, cellX: number, cellY: number): TileTexels;
  tuft(shape: number, bend: number): PackedCloud;
  far(code: TerrainCode): FarLook;
}

interface LipCell {
  readonly tile: TileTexels;
  /** Each tuft's root inside the cell, from its far-left corner. */
  readonly tufts: readonly { readonly placement: TuftPlacement; readonly dx: number; readonly dy: number }[];
}

export class LipState {
  readonly pose: PlanetPose;
  readonly grass: TuftOverlay;
  private readonly lazy: LazyGroundSample;
  private readonly cells = new Map<number, LipCell>();
  /** Per lip cell, its terrain code plus one - 0 for not yet asked. */
  private readonly terrain: Uint8Array;
  /** Local to planet for this anchor. */
  private toPlanet: ((x: number, y: number) => PlanetPoint) | undefined;

  /**
   * `base` is the field's sample for this pose, whose hashes the lip's
   * lattice inherits where the two overlap, so the seam cell is one tile.
   */
  constructor(
    pose: PlanetPose,
    private readonly bounds: LocalBounds,
    base: GroundSample,
    grassBounds: LocalBounds,
    private readonly art: LipArt,
  ) {
    this.pose = pose;
    this.lazy = lazyGroundSample(pose, bounds, base);
    this.grass = new TuftOverlay(grassBounds);
    const { minX, maxX, minY, maxY } = bounds;
    this.terrain = new Uint8Array((maxX - minX + 1) * (maxY - minY + 1));
  }

  /**
   * The lip as `rollGroundPixels` asks for it. Rows up to `liveMaxY` sway in
   * `ctx`'s wind; without a `ctx` - warming a state ahead - every tuft stands
   * upright, and the swaying rows are re-stamped every frame anyway.
   */
  look(water: WaterLook, liveMaxY: number, ctx?: FrameContext): CellLook {
    return {
      tile: (cellX, cellY) => this.cell(cellX, cellY).tile,
      tuft: (cellX, cellY) =>
        ctx !== undefined && cellY <= liveMaxY ? this.swaying(cellX, cellY, ctx) : this.upright(cellX, cellY),
      grass: this.grass,
      water,
      far: (cellX, cellY) => this.art.far(this.terrainAt(cellX, cellY)),
    };
  }

  /** A cell's tile, for the GPU lip's page atlas (`lip-gpu-data.ts`). */
  tileAt(cellX: number, cellY: number): TileTexels {
    return this.cell(cellX, cellY).tile;
  }

  /**
   * A cell's tufts as the GPU lip's tuft table holds them: each a frame of the
   * tuft atlas and its root in the cell. Rows up to `liveMaxY` bend in `ctx`'s
   * wind exactly as `swaying` bends them; without a `ctx`, and past it, upright.
   */
  tuftEntries(cellX: number, cellY: number, liveMaxY: number, ctx?: FrameContext): TuftEntry[] {
    const cell = this.cell(cellX, cellY);
    const first = cell.tufts[0]?.placement;
    if (first === undefined) {
      return [];
    }
    const live = ctx !== undefined && cellY <= liveMaxY ? ctx : undefined;
    const gust = live === undefined ? 0 : windAt(live.elapsedMs, first.planetX * TILE_WIDTH, first.planetY * TILE_WIDTH, live.wind);
    return cell.tufts.map(({ placement, dx, dy }) => ({
      frame: tuftAtlasFrame(
        placement.shape,
        live === undefined ? bendFrame(0) : bendFrame(swayBend(placement, gust, live.elapsedMs)),
      ),
      dx,
      dy,
    }));
  }

  /**
   * What a lip cell is made of, read off the planet at the cell's own sample
   * point - exactly `cellTerrain`'s answer, without the lattice round it. Out
   * of the lip's bounds is open grass.
   */
  terrainAt(cellX: number, cellY: number): TerrainCode {
    const { minX, maxX, minY, maxY } = this.bounds;
    if (cellX < minX || cellX > maxX || cellY < minY || cellY > maxY) {
      return GRASS;
    }
    const index = (cellY - minY) * (maxX - minX + 1) + (cellX - minX);
    const known = this.terrain[index] ?? 0;
    if (known !== 0) {
      return (known - 1) as TerrainCode;
    }
    this.toPlanet ??= localFrame(this.pose);
    const point = this.toPlanet(cellX, cellY);
    const code = cachedTerrain(point.x, point.y);
    this.terrain[index] = code + 1;
    return code;
  }

  private cell(cellX: number, cellY: number): LipCell {
    const key = (cellX + 2048) * 4096 + (cellY + 2048);
    let cell = this.cells.get(key);
    if (cell === undefined) {
      this.lazy.readAround(cellX, cellY);
      const sample = this.lazy.sample;
      const left = (cellX - sample.bounds.minX) * TILE_WIDTH;
      const top = (sample.bounds.maxY - cellY) * TILE_DEPTH;
      cell = {
        tile: this.art.tile(sample, cellX, cellY),
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

  /** Asked once an anchor per cell: the overlay keeps what it is given. */
  private upright(cellX: number, cellY: number): readonly TuftPiece[] | null {
    return this.gather(this.cell(cellX, cellY), () => bendFrame(0));
  }

  /**
   * The tufts bent by the wind, as the field bends them. Every tuft in a cell
   * names the cell's middle as its planet point, so one gust serves them all.
   */
  private swaying(cellX: number, cellY: number, ctx: FrameContext): readonly TuftPiece[] | null {
    const cell = this.cell(cellX, cellY);
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
      cloud: this.art.tuft(placement.shape, bend(placement)),
      x: dx - TILE_WIDTH / 2,
      y: dy - TILE_DEPTH,
    }));
  }
}
