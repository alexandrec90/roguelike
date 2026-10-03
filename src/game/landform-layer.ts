/**
 * The wiring for landforms: render the frame (`landform-render.ts`), cut it into
 * depth slices (`landform-slices.ts`), upload the slices as one atlas, and show
 * each through its own image at its row's depth.
 *
 * Re-rendered only when something it shows has moved: the pose, the scroll in
 * whole pixels, the hour's light, or a cloud shadow drifting over it. Standing
 * still costs nothing, and the far landforms - wholly past the field's edge,
 * where a stride moves them a fraction of a pixel - are kept between strides
 * and redrawn only when the pose changes or a strafe has slid them a pixel; the
 * near ones are drawn every frame over them (`mergeLandforms`). The scroll is taken in the same whole pixels the ground
 * is moved by (`scrollOffset`), so a landform's foot cannot shear against the
 * tiles it stands on mid-stride.
 */

import type { Image, Scene, Texture } from "../engine";
import { scrollOffset, type CameraFrame } from "./camera";
import type { FrameContext } from "./frame-context";
import { createLandformPixels, type LandformLight, type LandformPixels } from "./landform-frame";
import { isFarView, mergeLandforms, outlineLandforms, renderLandforms, viewsInSight } from "./landform-render";
import { packSlices, sliceLandforms } from "./landform-slices";
import { uniqueKey } from "./pixel-surface";
import { HORIZON_SCALE } from "./horizon";
import { RANK, rowAtFoot, standingDepth, TILE_DEPTH, TILE_WIDTH } from "./projection";
import { unlitHaze } from "./sky-paint";

/** Images made up front for slices; the pool grows if a frame wants more. */
const SLICE_POOL = 256;

/** The atlas grows in steps this tall, so a walk does not resize it every frame. */
const ATLAS_STEP = 64;

export class LandformLayer {
  private pixels!: LandformPixels;
  private near!: LandformPixels;
  private far!: LandformPixels;
  private farRendered = "";
  private nearWasEmpty = false;
  private texture!: Texture;
  private key = "";
  private atlasHeight = ATLAS_STEP;
  private atlas = new Uint8ClampedArray(0);
  /** How much of the atlas the last frame used, so a shrinking frame still clears it. */
  private lastAtlasHeight = 0;
  private slices: Image[] = [];
  private scene: Scene | undefined;
  private rendered = "";
  /** How tall the hero stands, for the window kept clear round him. */
  private heroHeight = 32;
  /** The last render's cost, ms - read it from the console when profiling. */
  lastFrameMs = 0;

  create(scene: Scene, width: number, height: number, heroHeight: number): void {
    this.scene = scene;
    this.heroHeight = heroHeight;
    this.pixels = createLandformPixels(width, height);
    this.near = createLandformPixels(width, height);
    this.far = createLandformPixels(width, height);
    this.key = uniqueKey("landforms");
    this.atlas = new Uint8ClampedArray(width * this.atlasHeight * 4);
    this.texture = scene.textures.addBytes(this.key, this.bytes(), width, this.atlasHeight);
    this.slices = Array.from({ length: SLICE_POOL }, () =>
      scene.add.image(0, 0, this.key).setOrigin(0, 0).setVisible(false),
    );
  }

  /** One frame; `shade` is the cloud shadow on the ground at a screen point. */
  /**
   * Nothing to do: these slices are one image per row, cheap batched quads,
   * placed as they are cut. The GPU layer merges rows here instead.
   */
  arrange(): void {}

  update(ctx: FrameContext, shade?: { readonly key: string; readonly at: (x: number, y: number) => number }): void {
    const frame = wholePixelFrame(ctx.frame);
    const signature = `${poseId(ctx.pose)}|${frame.phaseX}|${frame.phaseY}|${ctx.atmosphere.hours.toFixed(2)}|${ctx.atmosphere.overcast.toFixed(2)}|${shade?.key ?? ""}`;
    if (signature === this.rendered) {
      return;
    }
    this.rendered = signature;
    const started = performance.now();
    const views = viewsInSight(frame, ctx.pose, this.pixels);
    const light: LandformLight = {
      light: ctx.atmosphere.light,
      elevation: ctx.atmosphere.elevation,
      turn: ctx.pose.turn,
      haze: unlitHaze(ctx.atmosphere),
      cutaway: {
        x: ctx.frame.footX,
        y: ctx.frame.footY - this.heroHeight / 2,
        radiusX: this.heroHeight * 0.75,
        radiusY: this.heroHeight * 0.9,
        row: Math.round(rowAtFoot(ctx.frame.footY, ctx.frame.groundTop)),
      },
      ...(shade === undefined ? {} : { shade: shade.at }),
    };
    const far = views.filter((view) => isFarView(frame, view));
    // Far land moves at most `HORIZON_SCALE` of a tile across per tile strafed:
    // redraw it when that has come to a whole pixel, or the pose moved on. It
    // takes no cloud shadow - it stands over the horizon band, where the
    // ground's shadow pass leaves the sky clear - so the clouds riding the
    // ground as the hero walks do not redraw it every frame.
    const drift = Math.round(frame.phaseX * TILE_WIDTH * HORIZON_SCALE);
    const hour = `${ctx.atmosphere.hours.toFixed(2)}|${ctx.atmosphere.overcast.toFixed(2)}`;
    const farSignature = `${poseId(ctx.pose)}|${drift}|${hour}`;
    const farMoved = farSignature !== this.farRendered;
    if (farMoved) {
      this.farRendered = farSignature;
      const { shade: _clouds, ...unclouded } = light;
      renderLandforms(frame, far, unclouded, this.far);
    }
    const near = views.filter((view) => !far.includes(view));
    // Nothing near, then or now, and the far land where it was: the picture stands.
    if (near.length === 0 && this.nearWasEmpty && !farMoved) {
      this.lastFrameMs = performance.now() - started;
      return;
    }
    this.nearWasEmpty = near.length === 0;
    renderLandforms(frame, near, light, this.near);
    mergeLandforms(this.near, this.far, this.pixels);
    outlineLandforms(this.pixels);
    this.show();
    this.lastFrameMs = performance.now() - started;
  }

  destroy(): void {
    for (const image of this.slices) {
      image.destroy();
    }
    this.scene?.textures.remove(this.key);
  }

  /** The atlas's bytes as the GPU uploads them - the same memory. */
  private bytes(): Uint8Array {
    return new Uint8Array(this.atlas.buffer, this.atlas.byteOffset, this.atlas.length);
  }

  /** Cut, pack, upload, and point an image at each slice. */
  private show(): void {
    const { slices, atlasHeight } = sliceLandforms(this.pixels);
    this.fit(atlasHeight);
    packSlices(this.pixels, slices, this.atlas);
    if (slices.length > 0) {
      // Only the shelves in use, and those the last frame used, are uploaded.
      this.texture.uploadRows(this.bytes(), 0, Math.min(this.atlasHeight, Math.max(atlasHeight, this.lastAtlasHeight)));
      this.lastAtlasHeight = atlasHeight;
    }
    while (this.slices.length < slices.length && this.scene !== undefined) {
      this.slices.push(this.scene.add.image(0, 0, this.key).setOrigin(0, 0).setVisible(false));
    }
    this.slices.forEach((image, index) => {
      const slice = slices[index];
      if (slice === undefined) {
        image.setVisible(false);
        return;
      }
      image
        .setCrop(slice.atlasX, slice.atlasY, slice.right - slice.left, slice.bottom - slice.top)
        .setPosition(slice.left - slice.atlasX, slice.top - slice.atlasY)
        .setDepth(standingDepth(slice.row, RANK.body))
        .setVisible(true);
    });
  }

  /** Grow the atlas to hold `height` scanlines of slices. */
  private fit(height: number): void {
    const needed = Math.max(ATLAS_STEP, Math.ceil(height / ATLAS_STEP) * ATLAS_STEP);
    if (needed <= this.atlasHeight) {
      return;
    }
    this.atlasHeight = needed;
    this.atlas = new Uint8ClampedArray(this.pixels.width * needed * 4);
    if (this.scene === undefined) {
      return;
    }
    this.scene.textures.remove(this.key);
    this.texture = this.scene.textures.addBytes(this.key, this.bytes(), this.pixels.width, needed);
    for (const image of this.slices) {
      image.setTexture(this.key);
    }
  }
}

/**
 * The frame with its stride in flight rounded to the whole pixels the ground
 * is scrolled by, so the landforms and the tiles move together.
 */
export function wholePixelFrame(frame: CameraFrame): CameraFrame {
  const shift = scrollOffset(frame);
  return { ...frame, phaseX: -shift.x / TILE_WIDTH, phaseY: shift.y / TILE_DEPTH };
}

const POSE_IDS = new WeakMap<object, number>();
let poseCount = 0;

/** A number per pose object: the pose is frozen for a stride, so its identity is its version. */
function poseId(pose: object): number {
  let id = POSE_IDS.get(pose);
  if (id === undefined) {
    poseCount += 1;
    id = poseCount;
    POSE_IDS.set(pose, id);
  }
  return id;
}
