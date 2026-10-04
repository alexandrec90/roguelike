/**
 * Landforms drawn on the GPU: the same march as `landform-layer.ts`, per pixel
 * in a shader rather than per column on the CPU.
 *
 * Two kinds of pass, both shader passes of the engine's (`engine/pass.ts`). The **march** renders the whole
 * frame into a texture once - colour, and in alpha the depth row each pixel
 * shows (`gpu/landform-shader.ts`). Then one **slice** per row stands in the
 * display list at that row's depth, keeping only its own row's pixels, so a
 * tree behind a mesa is hidden and the hero walks round a mountain's flank
 * exactly as the CPU slices allowed. Each slice's rectangle comes from the
 * footprint and the peak (`rowRects`), never from the picture, so nothing is
 * read back.
 *
 * What the CPU still does per frame is small: which landforms are in sight,
 * the march schedule (a few hundred depths), and the rectangles. The pixel
 * work - ~5 ms a walking frame on the CPU - is the GPU's, and a cloud drifting
 * over a mountain re-runs a pass on the GPU instead of the CPU march.
 *
 * Needs WebGL2 (`hasWebGL2`); the scene keeps the CPU layer for anything else.
 */

import type { GameObject, Image, Scene, ShaderPass, UniformValue } from "../engine";
import { CLOUD_TILE_HEIGHT, CLOUD_TILE_WIDTH, cloudTile, type CloudShade } from "./cloud-shadow";
import type { FrameContext } from "./frame-context";
import { FloatTexture } from "./gpu/float-texture";
import { LANDFORM_VERTEX_SHADER, RAMP_COLOURS, RAMP_SPANS, WINDOW_COLOUR } from "./gpu/landform-glsl";
import {
  LANDFORM_BLOCK_SHADER,
  LANDFORM_MARCH_SHADER,
  LANDFORM_OUTLINE_SHADER,
  LANDFORM_PACK_SHADER,
  LANDFORM_PROBE_SHADER,
} from "./gpu/landform-shader";
import { heroCutaway } from "./landform-cutaway";
import type { LandformView } from "./landform-frame";
import {
  BLOCK_STEPS,
  columnBounds,
  FIELD_ATLAS_HEIGHT,
  FIELD_ATLAS_WIDTH,
  FieldAtlas,
  highestReach,
  MAX_STEPS,
  MAX_VIEWS,
  packField,
  SCHEDULE_WIDTH,
  scheduleTexels,
  viewUniforms,
} from "./landform-gpu-data";
import {
  ATLAS_ROWS,
  groupRows,
  rowBase,
  rowRects,
  stackBands,
  type Band,
  type Obstacle,
  type RowRect,
} from "./landform-gpu-rows";
import { wholePixelFrame } from "./landform-layer";
import { marchSchedule } from "./landform-march";
import { isFarView, viewsInSight } from "./landform-render";
import { uniqueKey } from "./pixel-surface";
import { RANK, standingDepth } from "./projection";
import { unlitHaze } from "./sky-paint";

/** Slices made up front; the pool grows if a frame wants more. */
const SLICE_POOL = 96;

/** Texels across the band table, one per atlas row. */
const BAND_WIDTH = 256;

/** Where a standing object is and how it sorts, or undefined for one that cannot overlap a slice. */
function standingBounds(object: GameObject): Obstacle | undefined {
  if (!object.visible) {
    return undefined;
  }
  const box = object.bounds();
  return box === undefined ? undefined : { depth: object.depth, ...box };
}

type Pass = ShaderPass;

/** Everything the march's uniform callback reads, set once per render. */
interface MarchUniforms {
  readonly values: Record<string, UniformValue>;
}

export class LandformGpuLayer {
  private scene!: Scene;
  private width = 0;
  private height = 0;
  private heroHeight = 32;
  private atlas = new FieldAtlas();
  private fields!: FloatTexture;
  private schedule!: FloatTexture;
  private columns!: FloatTexture;
  private probe!: Pass;
  private blocks!: Pass;
  private march!: Pass;
  private lined!: Pass;
  private pack!: Pass;
  private bands!: FloatTexture;
  private readonly bandData = new Float32Array(ATLAS_ROWS * 4);
  private marchUniforms: MarchUniforms = { values: {} };
  private readonly slices: Image[] = [];
  private readonly sliceSet = new Set<GameObject>();
  private rendered = "";
  /** The rows the last march drew, and the farthest that kept its own code. */
  private rects: readonly RowRect[] = [];
  private base = 0;
  /** The last frame's CPU share, ms - read it from the console when profiling. */
  lastFrameMs = 0;

  create(scene: Scene, width: number, height: number, heroHeight: number): void {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.heroHeight = heroHeight;
    this.fields = new FloatTexture(scene, uniqueKey("landform-fields"), FIELD_ATLAS_WIDTH, FIELD_ATLAS_HEIGHT);
    this.schedule = new FloatTexture(scene, uniqueKey("landform-steps"), SCHEDULE_WIDTH, (MAX_STEPS * 2) / SCHEDULE_WIDTH);
    const clouds = new FloatTexture(scene, uniqueKey("landform-clouds"), CLOUD_TILE_WIDTH, CLOUD_TILE_HEIGHT);
    clouds.write(0, 0, CLOUD_TILE_WIDTH, CLOUD_TILE_HEIGHT, cloudLevels());
    this.columns = new FloatTexture(scene, uniqueKey("landform-columns"), width, 1);
    const data = { u_field: this.fields.key, u_steps: this.schedule.key, u_columns: this.columns.key };
    this.probe = this.pass("landform-probe", LANDFORM_PROBE_SHADER, width, MAX_STEPS, data);
    this.blocks = this.pass("landform-blocks", LANDFORM_BLOCK_SHADER, width, MAX_STEPS / BLOCK_STEPS, {
      u_tops: this.probe.key,
    });
    this.march = this.pass("landform-march", LANDFORM_MARCH_SHADER, width, height, {
      ...data,
      u_cloud: clouds.key,
      u_tops: this.probe.key,
      u_blocks: this.blocks.key,
    });
    this.lined = this.pass("landform-outline", LANDFORM_OUTLINE_SHADER, width, height, { u_march: this.march.key });
    this.bands = new FloatTexture(scene, uniqueKey("landform-bands"), BAND_WIDTH, ATLAS_ROWS / BAND_WIDTH);
    this.pack = this.pass("landform-pack", LANDFORM_PACK_SHADER, width, ATLAS_ROWS, {
      u_lined: this.lined.key,
      u_bands: this.bands.key,
    });
    for (let index = 0; index < SLICE_POOL; index += 1) {
      this.addSlice();
    }
  }

  update(ctx: FrameContext, shade: CloudShade): void {
    const frame = wholePixelFrame(ctx.frame);
    const signature = `${poseKey(ctx.pose)}|${frame.phaseX}|${frame.phaseY}|${ctx.atmosphere.hours.toFixed(2)}|${ctx.atmosphere.overcast.toFixed(2)}|${shade.key}|${frame.footX},${frame.footY}`;
    if (signature === this.rendered) {
      return;
    }
    this.rendered = signature;
    const started = performance.now();
    const views = nearestViews(viewsInSight(frame, ctx.pose, { width: this.width, height: this.height }));
    const rects = rowRects(frame, views, this.width, this.height);
    const base = rowBase(rects.map((rect) => rect.row));
    this.marchUniforms = { values: this.uniforms(ctx, frame, views, shade, base) };
    // Every pass renders its whole target; unused rows are skipped in the
    // shader instead (a step past the count, an empty band), so a target never
    // has to be resized and the frames cropped from it never go stale.
    for (const pass of [this.probe, this.blocks, this.march, this.lined]) {
      pass.render();
    }
    this.rects = rects;
    this.base = base;
    this.lastFrameMs = performance.now() - started;
  }

  /**
   * Cut the picture into slices around whatever stands in front of it this
   * frame. Called last, once every layer has placed its objects: a slime that
   * stepped onto a new row moves where the cuts must be.
   */
  arrange(): void {
    // Only something sorted between two of the rows can split them, so nothing
    // outside their depths is measured - most of a display list of ~700.
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const rect of this.rects) {
      const depth = standingDepth(rect.row, RANK.body);
      low = Math.min(low, depth);
      high = Math.max(high, depth);
    }
    const obstacles: Obstacle[] = [];
    for (const object of this.scene.children.list) {
      const depth = object.depth;
      if (depth < low || depth > high || this.sliceSet.has(object)) {
        continue;
      }
      const bounds = standingBounds(object);
      if (bounds !== undefined) {
        obstacles.push(bounds);
      }
    }
    const groups = stackBands(groupRows(this.rects, this.base, obstacles, (row) => standingDepth(row, RANK.body)));
    const used = this.fillBands(groups);
    this.pack.render();
    this.place(groups, used);
  }

  destroy(): void {
    for (const slice of this.slices) {
      slice.destroy();
    }
    for (const pass of [this.probe, this.blocks, this.march, this.lined, this.pack]) {
      pass.destroy();
    }
  }

  /** Write each band's rows into the table the pack pass reads; how many atlas rows are in use. */
  private fillBands(groups: readonly Band[]): number {
    const used = groups.reduce((most, band) => Math.max(most, band.atlasY + band.group.rect.bottom - band.group.rect.top), 0);
    const rows = Math.min(ATLAS_ROWS, Math.ceil(Math.max(used, 1) / BAND_WIDTH) * BAND_WIDTH);
    const data = this.bandData;
    data.fill(0, 0, rows * 4);
    for (const { group, atlasY } of groups) {
      for (let y = group.rect.top; y < group.rect.bottom; y += 1) {
        const at = (atlasY + y - group.rect.top) * 4;
        data[at] = y;
        data[at + 1] = group.lowCode;
        data[at + 2] = group.highCode;
        data[at + 3] = 1;
      }
    }
    this.bands.write(0, 0, BAND_WIDTH, rows / BAND_WIDTH, this.bandData.subarray(0, rows * 4));
    return used;
  }

  /**
   * One render-to-texture pass over the shared uniforms. `samplers` maps each
   * sampler uniform to the texture it reads, in texture-unit order.
   */
  private pass(
    name: string,
    source: string,
    width: number,
    height: number,
    samplers: Readonly<Record<string, string>>,
  ): Pass {
    return this.scene.add.pass({
      name,
      fragmentSource: source,
      vertexSource: LANDFORM_VERTEX_SHADER,
      width,
      height,
      samplers,
      uniforms: () => this.marchUniforms.values,
    });
  }

  private uniforms(
    ctx: FrameContext,
    frame: ReturnType<typeof wholePixelFrame>,
    views: readonly LandformView[],
    shade: CloudShade,
    base: number,
  ): Record<string, UniformValue> {
    const slots = views.map((view) => {
      const placed = this.atlas.place(view.field);
      if (placed.fresh) {
        const packed = packField(view.field);
        this.fields.write(placed.slot.x, placed.slot.y, packed.width, packed.height, packed.data);
      }
      return placed.slot;
    });
    const steps = marchSchedule(frame, views).slice(0, MAX_STEPS);
    const texels = scheduleTexels(steps, highestReach(steps, views));
    this.schedule.write(0, 0, SCHEDULE_WIDTH, texels.length / 4 / SCHEDULE_WIDTH, texels);
    this.columns.write(0, 0, this.width, 1, columnBounds(frame, views, steps, this.width));
    const view = viewUniforms(
      views,
      slots,
      views.map((each) => isFarView(frame, each)),
    );
    const { atmosphere } = ctx;
    const lift = Math.min(Math.max(atmosphere.elevation, 0.1), 1);
    const across = Math.sqrt(1 - lift * lift);
    const haze = unlitHaze(atmosphere);
    const cut = heroCutaway(frame, views, steps, ctx.pose.turn, this.heroHeight);
    const clouds = shade.params;
    return {
      u_size: [this.width, this.height],
      u_atlasRows: ATLAS_ROWS,
      u_frame: [frame.footX, frame.footY, frame.phaseX, frame.phaseY],
      u_stepCount: steps.length,
      "u_viewA[0]": view.a,
      "u_viewB[0]": view.b,
      "u_viewC[0]": view.c,
      "u_viewD[0]": view.d,
      "u_viewE[0]": view.e,
      u_turn: [Math.cos(ctx.pose.turn), Math.sin(ctx.pose.turn)],
      u_light: [atmosphere.light.x * across, -atmosphere.light.y * across, lift],
      u_haze: [haze.r, haze.g, haze.b],
      u_cut: cut === undefined ? [0, 0, 1, 1] : [cut.x, cut.y, cut.radiusX, cut.radiusY],
      u_cutRow: cut === undefined ? [0, 0] : [cut.row, 1],
      u_shade: clouds === undefined ? [0, 0, 0, 0] : [clouds.x, clouds.y, clouds.strength, clouds.margin],
      u_cloudSize: [CLOUD_TILE_WIDTH, CLOUD_TILE_HEIGHT],
      u_groundTop: frame.groundTop,
      u_rowBase: base,
      "u_ramp[0]": RAMP_COLOURS,
      "u_rampSpan[0]": RAMP_SPANS,
      u_window: WINDOW_COLOUR,
    };
  }

  /** Point one slice at each group of rows, at its nearest row's depth; hide the rest. */
  /** Point one image at each band of the atlas, at its group's depth; hide the rest. */
  private place(bands: readonly Band[], used: number): void {
    while (this.slices.length < bands.length) {
      this.addSlice();
    }
    this.slices.forEach((slice, index) => {
      const band = bands[index];
      if (band === undefined || used === 0) {
        slice.setVisible(false);
        return;
      }
      const { rect } = band.group;
      slice
        .setCrop(rect.left, band.atlasY, rect.right - rect.left, rect.bottom - rect.top)
        .setPosition(0, rect.top - band.atlasY)
        .setDepth(band.group.depth)
        .setVisible(true);
    });
  }

  private addSlice(): void {
    const slice = this.scene.add.image(0, 0, this.pack.key).setOrigin(0, 0).setVisible(false);
    this.slices.push(slice);
    this.sliceSet.add(slice);
  }
}

/** At most `MAX_VIEWS` landforms, the nearest kept. */
function nearestViews(views: readonly LandformView[]): LandformView[] {
  return [...views]
    .sort((a, b) => Math.hypot(a.centreX, a.centreY) - Math.hypot(b.centreX, b.centreY))
    .slice(0, MAX_VIEWS);
}

/** The cloud tile's multiply levels, 0..1, as float texels. */
function cloudLevels(): Float32Array {
  const tile = cloudTile();
  const data = new Float32Array(tile.width * tile.height * 4);
  for (let index = 0; index < tile.width * tile.height; index += 1) {
    data[index * 4] = (tile.data[index * 4] ?? 255) / 255;
  }
  return data;
}

const POSE_KEYS = new WeakMap<object, number>();
let poseCount = 0;

/** A number per pose object: the pose is frozen between whole tiles, so its identity is its version. */
function poseKey(pose: object): number {
  let key = POSE_KEYS.get(pose);
  if (key === undefined) {
    poseCount += 1;
    key = poseCount;
    POSE_KEYS.set(pose, key);
  }
  return key;
}
