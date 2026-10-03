/**
 * The horizon lip drawn on the GPU: the wiring of `gpu/lip-shader.ts`.
 *
 * One shader pass the size of the lip, off the display list, and
 * one image showing it at the horizon band's depth - where the CPU path's
 * `PixelSurface` stood. Each frame the CPU only says which cells the lip reads
 * (`visitLipCells`) and makes sure each has what the shader will ask of it: a
 * page for its tile and its puddle, its far colour, and its tufts at this
 * frame's bend. That is a few hundred table writes, most of them no change;
 * the 7,680 pixels are the GPU's.
 *
 * What a cell has is kept per anchor (`LipState`), so an anchor prepared ahead
 * (`warmTasks`) arrives with its tiles composed and paged in.
 */

import type { Image, Scene, ShaderPass, UniformValue } from "../engine";
import type { CameraFrame, LocalBounds } from "./camera";
import { scrollOffset } from "./camera";
import type { Rgb } from "./color";
import type { FrameContext } from "./frame-context";
import { FloatTexture } from "./gpu/float-texture";
import { LANDFORM_VERTEX_SHADER } from "./gpu/landform-glsl";
import { LIP_FRAGMENT_SHADER } from "./gpu/lip-shader";
import {
  CellTable,
  farLookTexels,
  lineTable,
  lipLines,
  MAX_LINES,
  NEEDS_FAR,
  NEEDS_TILE,
  NEEDS_TUFTS,
  PageAtlas,
  STRIDE_SHIFTS,
  tilePage,
  tuftAtlas,
  TuftTable,
  visitLipCells,
  warmChunks,
} from "./lip-gpu-data";
import { uniqueKey } from "./pixel-surface";
import { HORIZON_DEPTH } from "./projection";
import { FAR_LEVELS, type FarLook } from "./roll-far";
import type { LipState } from "./roll-ground-state";
import { MAX_WATER_ALPHAS, WATER_ALPHAS, type LipWater } from "./roll-water";

/** Pages across and down the atlas: 2,048 tiles and puddle cells, ~1.5 MB of bytes. */
const PAGE_COLUMNS = 32;
const PAGE_ROWS = 64;

/** What one anchor's lip has told the GPU. */
interface Tables {
  readonly cells: CellTable;
  readonly tufts: TuftTable;
}

/** One anchor's lip being filled in: whose tables, which water, and the frame's wind if it sways. */
interface Fill {
  readonly state: LipState;
  readonly water: LipWater;
  readonly waterId: number;
  readonly tables: Tables;
  readonly liveMaxY: number;
  readonly ctx: FrameContext | undefined;
}

let waterCount = 0;

export class LipGpu {
  readonly image: Image;
  private readonly pass: ShaderPass;
  private readonly lines: FloatTexture;
  private readonly cells: FloatTexture;
  private readonly pages: FloatTexture;
  private readonly tufts: FloatTexture;
  private readonly atlas = new PageAtlas(PAGE_COLUMNS, PAGE_ROWS);
  private readonly tables = new WeakMap<LipState, Tables>();
  private readonly waterIds = new WeakMap<LipWater, number>();
  private readonly alphas = new Float32Array(MAX_WATER_ALPHAS);
  private shown: LipState | undefined;
  private values: Record<string, UniformValue> = {};

  /**
   * `far` is what each terrain code looks like from too far to point sample:
   * grass, then dirt.
   */
  constructor(
    scene: Scene,
    private readonly width: number,
    frame: CameraFrame,
    private readonly lipBounds: LocalBounds,
    private readonly grassBounds: LocalBounds,
    far: readonly [FarLook, FarLook],
  ) {
    const blankCells = new CellTable(lipBounds);
    const blankTufts = new TuftTable(grassBounds);
    this.lines = new FloatTexture(scene, uniqueKey("lip-lines"), MAX_LINES, 2);
    this.cells = new FloatTexture(scene, uniqueKey("lip-cells"), blankCells.width, blankCells.height);
    this.pages = new FloatTexture(scene, uniqueKey("lip-pages"), this.atlas.width, this.atlas.height, "byte");
    this.tufts = new FloatTexture(scene, uniqueKey("lip-tufts"), blankTufts.width, blankTufts.height);
    const grass = tuftAtlas();
    const atlas = new FloatTexture(scene, uniqueKey("lip-tuft-atlas"), grass.width, grass.height, "byte");
    atlas.write(0, 0, grass.width, grass.height, grass.data);
    const farLooks = new FloatTexture(scene, uniqueKey("lip-far-looks"), FAR_LEVELS, far.length, "byte");
    farLooks.write(0, 0, FAR_LEVELS, far.length, farLookTexels(far));
    const samplers: Readonly<Record<string, string>> = {
      u_lines: this.lines.key,
      u_cells: this.cells.key,
      u_pages: this.pages.key,
      u_tufts: this.tufts.key,
      u_tuftAtlas: atlas.key,
      u_farLooks: farLooks.key,
    };
    this.pass = scene.add.pass({
      name: "roll-ground-gpu",
      fragmentSource: LIP_FRAGMENT_SHADER,
      vertexSource: LANDFORM_VERTEX_SHADER,
      width,
      height: frame.rollHeight,
      samplers,
      uniforms: () => this.values,
    });
    this.image = scene.add
      .image(0, frame.groundTop - frame.rollHeight, this.pass.key)
      .setOrigin(0, 0)
      .setDepth(HORIZON_DEPTH);
  }

  /** Draw the lip for this frame from `state`, with `water` on it and `haze` over it. */
  render(ctx: FrameContext, state: LipState, water: LipWater, liveMaxY: number, haze: Rgb): void {
    this.atlas.tick();
    const shift = scrollOffset(ctx.frame);
    const tables = this.tablesFor(state);
    if (this.shown !== state) {
      this.shown = state;
      tables.cells.dirty = true;
      tables.tufts.markAll();
    }
    const fill: Fill = { state, water, waterId: this.waterId(water), tables, liveMaxY, ctx };
    visitLipCells(ctx.frame, this.width, { x: [shift.x], y: [shift.y] }, (cellX, cellY, needs) =>
      this.fillCell(fill, cellX, cellY, needs),
    );
    this.upload(tables);
    this.lines.write(0, 0, MAX_LINES, 2, lineTable(lipLines(ctx.frame, shift)));
    this.alphas.set(WATER_ALPHAS.slice(0, MAX_WATER_ALPHAS));
    this.values = {
      u_size: [this.width, ctx.frame.rollHeight],
      u_frame: [ctx.frame.footX, shift.x],
      u_cellBounds: [this.lipBounds.minX, this.lipBounds.minY, tables.cells.width, tables.cells.height],
      u_tuftBounds: [this.grassBounds.minX, this.grassBounds.minY, this.grassBounds.maxX, this.grassBounds.maxY],
      u_pageColumns: PAGE_COLUMNS,
      u_haze: [haze.r, haze.g, haze.b],
      "u_alphas[0]": this.alphas,
    };
    this.pass.render();
  }

  /**
   * The work for an anchor the hero is walking into, as tasks: every cell any
   * stride from it can show, its tile composed and paged in, its far colour
   * read, its puddle paged and its tufts laid in upright.
   *
   * Cut by cost rather than by scanline: the first scanline that point-samples
   * composes a hundred tiles on its own, and a task is never split once begun.
   */
  warmTasks(state: LipState, water: () => LipWater | undefined, frame: CameraFrame, liveMaxY: number): (() => void)[] {
    const cells: [number, number, number][] = [];
    visitLipCells(frame, this.width, STRIDE_SHIFTS, (cellX, cellY, needs) => cells.push([cellX, cellY, needs]));
    return warmChunks(cells).map((chunk) => () => {
      const lip = water();
      if (lip === undefined) {
        return;
      }
      const fill: Fill = { state, water: lip, waterId: this.waterId(lip), tables: this.tablesFor(state), liveMaxY, ctx: undefined };
      for (const [cellX, cellY, needs] of chunk) {
        this.fillCell(fill, cellX, cellY, needs);
      }
    });
  }

  destroy(): void {
    this.image.destroy();
    this.pass.destroy();
  }

  private tablesFor(state: LipState): Tables {
    let tables = this.tables.get(state);
    if (tables === undefined) {
      tables = { cells: new CellTable(this.lipBounds), tufts: new TuftTable(this.grassBounds) };
      this.tables.set(state, tables);
    }
    return tables;
  }

  /** One cell's tile page, far colour, puddle page and tufts, as `needs` asks. */
  private fillCell(fill: Fill, cellX: number, cellY: number, needs: number): void {
    const { state, water, waterId, liveMaxY, ctx } = fill;
    const { cells, tufts } = fill.tables;
    // Upright rows are laid in once; the swaying ones every frame there is one.
    const sways = ctx !== undefined && cellY <= liveMaxY;
    if ((needs & NEEDS_TUFTS) !== 0 && tufts.contains(cellX, cellY) && (sways || !tufts.has(cellX, cellY))) {
      tufts.set(cellX, cellY, state.tuftEntries(cellX, cellY, liveMaxY, ctx));
    }
    if (cells.index(cellX, cellY) < 0) {
      return;
    }
    if ((needs & NEEDS_TILE) !== 0) {
      const tile = state.tileAt(cellX, cellY);
      cells.set(cellX, cellY, 0, this.atlas.slotFor(tile, (data, at, stride) => tilePage(tile, data, at, stride)));
    }
    if ((needs & NEEDS_FAR) !== 0) {
      cells.set(cellX, cellY, 1, state.terrainAt(cellX, cellY) + 1);
    }
    const wet = water.wetCell(cellX, cellY);
    const page = (data: Uint8Array, at: number, stride: number): void => water.page(cellX, cellY, data, at, stride);
    cells.set(cellX, cellY, 2, wet ? this.atlas.slotFor(`${waterId}:${cellX}:${cellY}`, page) : 0);
  }

  /** Send the shown anchor's changed tables, and any new pages, to the GPU. */
  private upload(tables: Tables): void {
    const pages = this.atlas.takeDirty();
    if (pages !== undefined) {
      this.pages.write(0, pages.from, this.atlas.width, pages.to - pages.from, this.atlas.data, pages.from * this.atlas.width * 4);
    }
    if (tables.cells.dirty) {
      this.cells.write(0, 0, tables.cells.width, tables.cells.height, tables.cells.data);
      tables.cells.dirty = false;
    }
    const rows = tables.tufts.takeDirty();
    if (rows !== undefined) {
      this.tufts.write(0, rows.from, tables.tufts.width, rows.to - rows.from, tables.tufts.data, rows.from * tables.tufts.width * 4);
    }
  }

  private waterId(water: LipWater): number {
    let id = this.waterIds.get(water);
    if (id === undefined) {
      waterCount += 1;
      id = waterCount;
      this.waterIds.set(water, id);
    }
    return id;
  }
}
