/**
 * The display list and what can stand on it.
 *
 * Five kinds of thing, which between them are every way the game puts pixels
 * on screen:
 *
 * | Kind | Is | Module |
 * | --- | --- | --- |
 * | `Image` | one frame of a texture, placed, cropped, tinted | here |
 * | `Blitter` | a row of `Bob`s from one texture, drawn as one object - the grass | here |
 * | `Graphics` | filled rectangles, for the handful of pixels too few to deserve a surface | `shapes.ts` |
 * | `Rectangle` | one filled rectangle that behaves like an image - a lightning flash | `shapes.ts` |
 * | `RenderTarget` | an image whose texture is drawn into: the lighting passes | `render-target.ts` |
 *
 * They sort by `depth`, ties broken by the order they were added, which is the
 * order Phaser drew them in - layers rely on it.
 */

import type { Batcher } from "./batcher";
import type { BlendMode } from "./blend";
import { emptyQuad, imageQuad, type FrameRect, type Quad, type QuadInput } from "./quad";
import type { Texture, TextureStore } from "./texture";

/** The 1×1 opaque white texture every fill is drawn from. */
export const WHITE_TEXTURE = "__WHITE";
/** A transparent placeholder an image can hold before it has a picture, as Phaser's. */
export const DEFAULT_TEXTURE = "__DEFAULT";

/** A screen rectangle, for anything that asks where an object stands. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** What a draw needs that is not the object's own. */
export interface RenderContext {
  readonly batcher: Batcher;
  readonly textures: TextureStore;
  readonly scrollX: number;
  readonly scrollY: number;
}

/** What every object is made with: where textures live and the list it stands on. */
export interface Stage {
  readonly textures: TextureStore;
  readonly list: DisplayList;
  readonly batcher: Batcher;
}

/** Parse `#rrggbb` or take a number; colours are 0xRRGGBB throughout. */
export function colorOf(value: number | string): number {
  return typeof value === "number" ? value : Number.parseInt(value.replace("#", ""), 16);
}

export abstract class GameObject {
  x = 0;
  y = 0;
  visible = true;
  alpha = 1;
  blendMode: BlendMode = "normal";
  /** Order of addition: the tie-break between equal depths. */
  serial = 0;
  private depthValue = 0;
  private list: DisplayList | undefined;

  constructor(protected readonly stage: Stage) {
    this.list = stage.list;
    stage.list.add(this);
  }

  get depth(): number {
    return this.depthValue;
  }

  setDepth(depth: number): this {
    if (depth !== this.depthValue) {
      this.depthValue = depth;
      this.list?.markUnsorted();
    }
    return this;
  }

  setPosition(x: number, y = x): this {
    this.x = x;
    this.y = y;
    return this;
  }

  setVisible(visible: boolean): this {
    this.visible = visible;
    return this;
  }

  setAlpha(alpha: number): this {
    this.alpha = alpha;
    return this;
  }

  setBlendMode(mode: BlendMode): this {
    this.blendMode = mode;
    return this;
  }

  /** Where it covers the screen, for objects that cover a rectangle; undefined otherwise. */
  bounds(): Box | undefined {
    return undefined;
  }

  /** Take it off the list for good. */
  destroy(): void {
    this.list?.remove(this);
    this.list = undefined;
  }

  abstract render(ctx: RenderContext): void;
}

/** One reusable quad input and output for a whole frame of images. */
const scratch: { -readonly [K in keyof QuadInput]: QuadInput[K] } = {
  x: 0,
  y: 0,
  originX: 0,
  originY: 0,
  scaleX: 1,
  scaleY: 1,
  flipX: false,
  flipY: false,
  frame: { x: 0, y: 0, width: 0, height: 0 },
  crop: undefined,
  scrollX: 0,
  scrollY: 0,
};
const scratchQuad: Quad = emptyQuad();

export class Image extends GameObject {
  originX = 0.5;
  originY = 0.5;
  scaleX = 1;
  scaleY = 1;
  flipX = false;
  flipY = false;
  tint = 0xffffff;
  crop: FrameRect | undefined;
  texture!: Texture;
  frame!: FrameRect;
  frameName: string | number | undefined;

  constructor(stage: Stage, x: number, y: number, key: string, frame?: string | number) {
    super(stage);
    this.x = x;
    this.y = y;
    this.setTexture(key, frame);
  }

  /** The frame's size, unscaled. */
  get width(): number {
    return this.frame.width;
  }

  get height(): number {
    return this.frame.height;
  }

  get displayWidth(): number {
    return this.frame.width * this.scaleX;
  }

  get displayHeight(): number {
    return this.frame.height * this.scaleY;
  }

  get displayOriginX(): number {
    return this.originX * this.frame.width;
  }

  get displayOriginY(): number {
    return this.originY * this.frame.height;
  }

  setTexture(key: string, frame?: string | number): this {
    this.texture = this.stage.textures.get(key);
    return this.setFrame(frame);
  }

  setFrame(frame?: string | number): this {
    this.frameName = frame;
    this.frame = this.texture.frame(frame);
    return this;
  }

  setOrigin(x: number, y = x): this {
    this.originX = x;
    this.originY = y;
    return this;
  }

  setScale(x: number, y = x): this {
    this.scaleX = x;
    this.scaleY = y;
    return this;
  }

  setFlipX(flip: boolean): this {
    this.flipX = flip;
    return this;
  }

  setFlipY(flip: boolean): this {
    this.flipY = flip;
    return this;
  }

  setTint(tint = 0xffffff): this {
    this.tint = tint;
    return this;
  }

  clearTint(): this {
    this.tint = 0xffffff;
    return this;
  }

  /** Show only this part of the frame, in frame pixels; no arguments shows it whole. */
  setCrop(x?: number, y?: number, width?: number, height?: number): this {
    this.crop = x === undefined ? undefined : { x, y: y ?? 0, width: width ?? 0, height: height ?? 0 };
    return this;
  }

  get isCropped(): boolean {
    return this.crop !== undefined;
  }

  override bounds(): Box | undefined {
    const left = this.x - this.displayOriginX * this.scaleX;
    const top = this.y - this.displayOriginY * this.scaleY;
    return { left, top, right: left + this.displayWidth, bottom: top + this.displayHeight };
  }

  render(ctx: RenderContext): void {
    if (this.alpha <= 0) {
      return;
    }
    scratch.x = this.x;
    scratch.y = this.y;
    scratch.originX = this.originX;
    scratch.originY = this.originY;
    scratch.scaleX = this.scaleX;
    scratch.scaleY = this.scaleY;
    scratch.flipX = this.flipX;
    scratch.flipY = this.flipY;
    scratch.frame = this.frame;
    scratch.crop = this.crop;
    scratch.scrollX = ctx.scrollX;
    scratch.scrollY = ctx.scrollY;
    const quad = imageQuad(scratch, scratchQuad);
    if (quad !== undefined) {
      ctx.batcher.draw(this.texture, quad, this.tint, this.alpha, this.blendMode);
    }
  }
}

/** One picture in a `Blitter`: a frame at an offset from the blitter. */
export class Bob {
  x: number;
  y: number;
  visible = true;
  alpha = 1;
  tint = 0xffffff;
  frame: FrameRect;

  constructor(
    private readonly texture: Texture,
    x: number,
    y: number,
    frame?: string | number,
  ) {
    this.x = x;
    this.y = y;
    this.frame = texture.frame(frame);
  }

  setFrame(frame?: string | number): this {
    this.frame = this.texture.frame(frame);
    return this;
  }

  setVisible(visible: boolean): this {
    this.visible = visible;
    return this;
  }

  setTint(tint: number): this {
    this.tint = tint;
    return this;
  }

  setAlpha(alpha: number): this {
    this.alpha = alpha;
    return this;
  }

  setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  /** Move, re-frame and show again, keeping the tint - as Phaser's `Bob.reset`. */
  reset(x: number, y: number, frame?: string | number): this {
    this.x = x;
    this.y = y;
    this.alpha = 1;
    this.visible = true;
    if (frame !== undefined) {
      this.setFrame(frame);
    }
    return this;
  }
}

export class Blitter extends GameObject {
  readonly bobs: Bob[] = [];
  private readonly texture: Texture;

  constructor(stage: Stage, x: number, y: number, key: string) {
    super(stage);
    this.x = x;
    this.y = y;
    this.texture = stage.textures.get(key);
  }

  create(x: number, y: number, frame?: string | number): Bob {
    const bob = new Bob(this.texture, x, y, frame);
    this.bobs.push(bob);
    return bob;
  }

  render(ctx: RenderContext): void {
    for (const bob of this.bobs) {
      if (!bob.visible || bob.alpha <= 0) {
        continue;
      }
      const left = Math.round(this.x + bob.x - ctx.scrollX);
      const top = Math.round(this.y + bob.y - ctx.scrollY);
      const frame = bob.frame;
      scratchQuad.left = left;
      scratchQuad.top = top;
      scratchQuad.right = left + frame.width;
      scratchQuad.bottom = top + frame.height;
      scratchQuad.u0 = frame.x;
      scratchQuad.v0 = frame.y;
      scratchQuad.u1 = frame.x + frame.width;
      scratchQuad.v1 = frame.y + frame.height;
      ctx.batcher.draw(this.texture, scratchQuad, bob.tint, bob.alpha * this.alpha, this.blendMode);
    }
  }
}

/** Every object on screen, kept in draw order. */
export class DisplayList {
  private readonly objects: GameObject[] = [];
  private next = 0;
  private unsorted = false;

  add(object: GameObject): void {
    object.serial = this.next;
    this.next += 1;
    this.objects.push(object);
    this.unsorted = true;
  }

  remove(object: GameObject): void {
    const index = this.objects.indexOf(object);
    if (index >= 0) {
      this.objects.splice(index, 1);
    }
  }

  markUnsorted(): void {
    this.unsorted = true;
  }

  /** The serial the next object added will get: every object added since a reading has one at or above it. */
  get issued(): number {
    return this.next;
  }

  /** Every object, in no promised order - for a layer that inspects what else is standing. */
  get list(): readonly GameObject[] {
    return this.objects;
  }

  /** Every object back to front: by depth, then by when it was added. */
  sorted(): readonly GameObject[] {
    if (this.unsorted) {
      this.objects.sort((a, b) => a.depth - b.depth || a.serial - b.serial);
      this.unsorted = false;
    }
    return this.objects;
  }
}
